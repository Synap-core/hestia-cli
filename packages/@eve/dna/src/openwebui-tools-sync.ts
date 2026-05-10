/**
 * @eve/dna — Synap → OpenWebUI external tool server registration.
 *
 * OpenWebUI supports OpenAPI tool servers: register an OpenAPI spec URL +
 * bearer token, and OWUI exposes the listed operations as tools an LLM can
 * call. This module pushes Synap's Hub Protocol OpenAPI spec into that
 * registry so Synap's 30+ Hub endpoints (memory, entities, channels,
 * knowledge, sessions, agents, …) become tools every chat can use, without
 * re-implementing them in Python sidecar pipelines.
 *
 * v0.9.4 endpoints used:
 *   GET  /api/v1/configs/tool_servers         → admin → ToolServersConfigForm
 *   POST /api/v1/configs/tool_servers         → admin ← ToolServersConfigForm
 *
 *   ToolServersConfigForm = { TOOL_SERVER_CONNECTIONS: ToolServerConnection[] }
 *
 *   ToolServerConnection = {
 *     url, path, type, auth_type, headers, key, config, info
 *   }
 *
 * Migration from < v0.9: this used to live inside the OpenAI persisted
 * config blob as `config.tool_server.connections[]`, written via the old
 * `POST /api/v1/configs/`. v0.9 promoted tool servers to a dedicated
 * sub-route so we no longer round-trip the whole config to update them.
 *
 * Container-network URL: the URL pushed into OWUI must be reachable from
 * inside the OWUI container. Synap exposes its OpenAPI spec at
 * `/api/hub/openapi.json` (mounted by `hub-protocol-rest.ts`). The Synap
 * pod's container name on the eve-network is `eve-brain-synap` (network
 * alias added in `connectToEveNetwork`) and it listens on internal port
 * 4000 — same address we already write into sidecars' env via
 * SYNAP_BACKEND_INTERNAL_URL.
 *
 * Idempotency: we GET the current TOOL_SERVER_CONNECTIONS list, find the
 * Eve-managed entry by `name`, and only POST back when the URL or bearer
 * key actually differ.
 *
 * Failure modes:
 *   - admin login fails → throw (caller can't proceed)
 *   - Synap OpenAPI endpoint 404 / non-JSON → return `registered: false`,
 *     no throw. We don't block on a missing upstream endpoint.
 */
import { SYNAP_BACKEND_INTERNAL_URL } from './components.js';
import { getAdminJwt, resolveOpenwebuiAdminUrl } from './openwebui-admin.js';
import {
  readAgentKeyOrLegacySync,
  type EveSecrets,
} from './secrets-contract.js';

// ── Types ──

export interface ToolsSyncResult {
  /** Tool server is now registered in OpenWebUI. */
  registered: boolean;
  /** Number of operations exposed by the registered OpenAPI spec. */
  toolCount: number;
  /** The display name shown in OpenWebUI's tool picker. */
  serverName: string;
  /** OpenAPI spec URL pushed to OpenWebUI (container-network address). */
  endpointUrl: string;
}

/**
 * One entry in OWUI's `TOOL_SERVER_CONNECTIONS` list (v0.9.4 schema).
 *
 * Source: `backend/open_webui/routers/configs.py` ToolServerConnection model.
 * Extra fields are tolerated by the backend (`extra='allow'`); we set the
 * minimum required to register an OpenAPI server with bearer auth.
 */
interface OpenwebuiToolServerConnection {
  /** Spec URL — fetched by OWUI from inside its own container. */
  url: string;
  /** Path within the spec to mount tools at. Empty string = root. */
  path: string;
  /** Server type — defaults to "openapi" on OWUI. */
  type?: 'openapi' | 'mcp';
  /** Auth scheme name — "bearer" matches the `key` field semantics. */
  auth_type?: string;
  /** Bearer token used by OWUI when calling the upstream API. */
  key?: string;
  /** Display name shown in the tool picker. */
  name?: string;
  /** Optional config blob — OWUI passes this back when calling tools. */
  config?: Record<string, unknown>;
  /** Optional cached info from the spec (servers, title, etc.). */
  info?: Record<string, unknown>;
  /** Optional auth headers for non-bearer schemes. */
  headers?: Record<string, string> | string;
}

/** v0.9.4 wire shape: `{ TOOL_SERVER_CONNECTIONS: [...] }`. */
interface ToolServersConfigForm {
  TOOL_SERVER_CONNECTIONS: OpenwebuiToolServerConnection[];
}

const SYNAP_TOOL_SERVER_NAME = 'Synap Hub Protocol';
const HUB_OPENAPI_PATH = '/api/hub/openapi.json';

// ── Helpers ──

/**
 * Container-internal URL for the Synap pod's OpenAPI spec.
 *
 * OWUI's container resolves `eve-brain-synap` via Docker DNS on the shared
 * `eve-network`. We bypass Traefik / public domains entirely so this works
 * before SSL is configured and stays correct when the public domain changes.
 *
 * Pinned to `SYNAP_BACKEND_INTERNAL_URL` from the component registry so a
 * future container rename is a one-line change there.
 */
function synapOpenapiContainerUrl(hubBaseUrl: string): string {
  // The hubBaseUrl arg lets a future caller (test, custom deploy) override
  // the host. Default: the in-network Synap backend address. We strip any
  // trailing /api/hub since the OpenAPI doc lives at /api/hub/openapi.json.
  const trimmed = (hubBaseUrl || SYNAP_BACKEND_INTERNAL_URL).replace(/\/+$/, '');
  // Caller may pass either the bare backend URL ("http://eve-brain-synap:4000")
  // or the full Hub base URL ("http://eve-brain-synap:4000/api/hub"). Both
  // collapse to the same OpenAPI path here.
  if (trimmed.endsWith('/api/hub')) return `${trimmed}/openapi.json`;
  return `${trimmed}${HUB_OPENAPI_PATH}`;
}

/**
 * Fetch the Synap OpenAPI spec and return the count of operations.
 *
 * Reachability check:
 *   - We hit the SAME URL we'll register with OWUI, but from the host —
 *     this works because Eve also publishes the loopback override for
 *     on-host introspection. If the host can't reach it but OWUI's
 *     container can, we still get a fair signal: the upstream endpoint
 *     exists and serves valid JSON.
 *   - If the URL is the in-network one (`http://eve-brain-synap:4000/...`)
 *     and we're running on the host, the host hostname won't resolve.
 *     We fall back to a probe via the COMPONENT registry's host port, but
 *     since the synap component publishes hostPort=null we instead probe
 *     the public Traefik route if a domain is configured. Skipping this
 *     entirely is safe — OWUI itself will surface a clear "spec unreachable"
 *     error in its UI if the endpoint is wrong.
 *
 * Returns:
 *   - { ok: true, paths: number } when the spec is reachable and valid.
 *   - { ok: false } when the endpoint 404s, non-JSON, or refuses connection.
 *     Caller treats this as "not yet — skip Wave 1 registration".
 */
async function fetchSynapOpenapi(
  hubBaseUrl: string,
): Promise<{ ok: true; paths: number } | { ok: false }> {
  // For host-side probing we accept any URL — container-network names
  // typically won't resolve from the host but loopback / public URLs do.
  // We probe the URL the caller said the Hub lives at; if that fails the
  // OWUI registration would also fail, so we want the early skip.
  const probeUrl = (() => {
    const trimmed = (hubBaseUrl || '').replace(/\/+$/, '');
    if (!trimmed) return null;
    if (trimmed.endsWith('/api/hub')) return `${trimmed}/openapi.json`;
    if (trimmed.includes('/api/hub/')) return `${trimmed}/openapi.json`;
    return `${trimmed}${HUB_OPENAPI_PATH}`;
  })();

  if (!probeUrl) return { ok: false };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(probeUrl, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return { ok: false };
    const text = await res.text();
    if (!text || text.trimStart().startsWith('<')) return { ok: false };
    const parsed = JSON.parse(text) as { openapi?: string; paths?: Record<string, unknown> };
    if (typeof parsed.openapi !== 'string') return { ok: false };
    const paths = parsed.paths && typeof parsed.paths === 'object'
      ? Object.keys(parsed.paths).length
      : 0;
    return { ok: true, paths };
  } catch {
    return { ok: false };
  }
}

/**
 * GET /api/v1/configs/tool_servers — read the current tool-server list.
 * Returns the bare connections array; throws on transport / auth failure.
 */
async function getToolServerConnections(
  jwt: string,
  baseUrl: string,
): Promise<OpenwebuiToolServerConnection[]> {
  const url = `${baseUrl}/api/v1/configs/tool_servers`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GET /api/v1/configs/tool_servers HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  const text = await res.text();
  if (text.trimStart().startsWith('<')) {
    throw new Error('GET /api/v1/configs/tool_servers returned HTML — admin route not registered on this OWUI build');
  }
  const parsed = JSON.parse(text) as Partial<ToolServersConfigForm> | OpenwebuiToolServerConnection[];
  if (Array.isArray(parsed)) return parsed;
  return parsed.TOOL_SERVER_CONNECTIONS ?? [];
}

/**
 * POST /api/v1/configs/tool_servers — overwrite the tool-server list with
 * the supplied connections. We pass the full new list (not a delta) since
 * the endpoint replaces the whole array.
 */
async function saveToolServerConnections(
  jwt: string,
  baseUrl: string,
  connections: OpenwebuiToolServerConnection[],
): Promise<void> {
  const url = `${baseUrl}/api/v1/configs/tool_servers`;
  const body: ToolServersConfigForm = { TOOL_SERVER_CONNECTIONS: connections };
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    const respBody = await res.text().catch(() => '');
    throw new Error(`POST /api/v1/configs/tool_servers HTTP ${res.status}: ${respBody.slice(0, 200)}`);
  }
}

// ── Public API ──

/**
 * Register Synap Hub Protocol as an external OpenAPI tool server in OWUI.
 *
 * Idempotent:
 *   - If already registered with the same URL + key → no-op (no save).
 *   - If URL or key changed → updates the existing entry by name.
 *   - If not registered at all → appends a new entry.
 *
 * @param cwd      Eve home dir (where `.eve/secrets/secrets.json` lives).
 *                 Forwarded into `readAgentKeyOrLegacySync` indirectly via
 *                 the secrets blob the caller already loaded.
 * @param hubBaseUrl  Hub Protocol base URL — used both for the host-side
 *                    reachability probe and (when it's a container address)
 *                    as the URL pushed to OWUI. Container-internal addresses
 *                    are PREFERRED so the OWUI container resolves the spec
 *                    via Docker DNS rather than going out through Traefik.
 * @param secrets  Eve secrets blob; we read the eve agent's hubApiKey to
 *                 use as the bearer the OWUI container sends to Synap.
 *
 * @throws when OWUI admin login fails (no JWT). Returns a result object
 *         in every other failure mode so callers (and Wave 2 wiring) can
 *         carry on without surprises.
 */
export async function registerSynapAsOpenwebuiToolServer(
  _cwd: string,
  hubBaseUrl: string,
  secrets: EveSecrets,
): Promise<ToolsSyncResult> {
  // The URL we push to OWUI is always the container-internal one — that's
  // the address OWUI's container can actually reach. The probe URL may
  // differ (the host can't resolve container DNS) but for this Wave we
  // probe the same thing the OWUI container will eventually fetch and
  // accept that an unreachable host still indicates a missing endpoint.
  const endpointUrl = synapOpenapiContainerUrl(hubBaseUrl);

  // Reachability check first — if the upstream OpenAPI endpoint doesn't
  // exist, registering would push a broken pointer into OWUI. Skip
  // gracefully so Wave 2 (which adds the endpoint) is the only fix needed.
  const probe = await fetchSynapOpenapi(hubBaseUrl);
  if (!probe.ok) {
    console.log('Synap OpenAPI endpoint not found — skipping');
    return {
      registered: false,
      toolCount: 0,
      serverName: SYNAP_TOOL_SERVER_NAME,
      endpointUrl,
    };
  }

  // Single source of truth for OWUI's host base URL — honors the live
  // `docker port` mapping when an operator has overridden OPEN_WEBUI_PORT.
  const baseUrl = resolveOpenwebuiAdminUrl();
  const jwt = await getAdminJwt();
  if (!jwt) {
    throw new Error(
      'OpenWebUI admin login failed — cannot register Synap tool server',
    );
  }

  const apiKey = readAgentKeyOrLegacySync('eve', secrets);
  if (!apiKey) {
    throw new Error(
      'No eve agent hubApiKey in secrets — cannot register Synap tool server',
    );
  }

  // Read current tool-server list directly from the dedicated v0.9.4 sub-route.
  const connections = await getToolServerConnections(jwt, baseUrl);

  const existingIdx = connections.findIndex((c) => c.name === SYNAP_TOOL_SERVER_NAME);
  const existing = existingIdx >= 0 ? connections[existingIdx] : undefined;

  // Idempotency check: same URL + same bearer = no-op (avoid pointless POST).
  if (
    existing &&
    existing.url === endpointUrl &&
    existing.key === apiKey &&
    (existing.path ?? '') === ''
  ) {
    return {
      registered: true,
      toolCount: probe.paths,
      serverName: SYNAP_TOOL_SERVER_NAME,
      endpointUrl,
    };
  }

  // OWUI v0.9.4 Pydantic ToolServerConnection requires `config` even though
  // the field is typed optional in older schemas. POST without it returns
  // 422: `loc=["TOOL_SERVER_CONNECTIONS",0,"config"], msg="Field required"`.
  // An empty object satisfies the model — OWUI uses it for runtime tool
  // overrides (timeouts, headers per-tool) which we don't need here.
  const updatedEntry: OpenwebuiToolServerConnection = {
    url: endpointUrl,
    path: '',
    type: 'openapi',
    auth_type: 'bearer',
    key: apiKey,
    name: SYNAP_TOOL_SERVER_NAME,
    config: {},
  };

  const next = [...connections];
  if (existingIdx >= 0) {
    next[existingIdx] = { ...existing, ...updatedEntry };
  } else {
    next.push(updatedEntry);
  }

  await saveToolServerConnections(jwt, baseUrl, next);

  return {
    registered: true,
    toolCount: probe.paths,
    serverName: SYNAP_TOOL_SERVER_NAME,
    endpointUrl,
  };
}
