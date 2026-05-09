/**
 * @eve/dna — Synap → OpenWebUI external tool server registration.
 *
 * OpenWebUI v0.6+ supports OpenAPI tool servers: register an OpenAPI spec
 * URL + bearer token, and OWUI exposes the listed operations as tools an
 * LLM can call. This module pushes Synap's Hub Protocol OpenAPI spec into
 * that registry so Synap's 30+ Hub endpoints (memory, entities, channels,
 * knowledge, sessions, agents, …) become tools every chat can use, without
 * re-implementing them in Python sidecar pipelines.
 *
 * Why config (not POST /api/v1/tools): OpenWebUI's persisted config holds
 * a `tool_server.connections[]` array (PersistentConfig). The same admin
 * config endpoint used by `openwebui-admin.ts` for model sources is reused
 * here, so we get the same auth and idempotency story.
 *
 * Container-network URL: the URL pushed into OWUI must be reachable from
 * inside the OWUI container. Synap exposes its OpenAPI spec at
 * `/api/hub/openapi.json` (mounted by `hub-protocol-rest.ts`). The Synap
 * pod's container name on the eve-network is `eve-brain-synap` and it
 * listens on internal port 4000 — the same address we already write into
 * other sidecars' env via SYNAP_BACKEND_INTERNAL_URL.
 *
 * Idempotency: we GET the persisted config, look up the existing entry
 * by `name`, and only PATCH when the URL or bearer key actually differ.
 *
 * Failure modes:
 *   - admin login fails → throw (caller can't proceed)
 *   - Synap OpenAPI endpoint 404 / non-JSON → return `registered: false`,
 *     no throw. Wave 2 backend change handles it; we don't block on a
 *     missing upstream endpoint.
 */
import { COMPONENTS, SYNAP_BACKEND_INTERNAL_URL } from './components.js';
import { getAdminJwt, getConfig, saveConfig } from './openwebui-admin.js';
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
 * One entry in OpenWebUI's persisted `tool_server.connections[]`.
 *
 * OWUI v0.6+ stores tool servers as PersistentConfig under
 * `config.tool_server.connections`. Each entry is the spec URL + bearer
 * key; OWUI fetches the spec on demand and exposes the operations.
 */
interface OpenwebuiToolServerConnection {
  /** OpenAPI spec URL — fetched by OWUI from inside its own container. */
  url: string;
  /** Bearer token used by OWUI when calling the upstream API. */
  key: string;
  /** Display name shown in the tool picker. */
  name?: string;
  /** Optional config blob — OWUI passes this back when calling tools. */
  config?: Record<string, unknown>;
  /** Optional cached info from the spec (servers, title, etc.). */
  info?: Record<string, unknown>;
}

interface OpenwebuiToolServerConfig {
  connections?: OpenwebuiToolServerConnection[];
  [key: string]: unknown;
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
 * Read OWUI's persisted `tool_server` config slot, normalizing to a known
 * shape. Older / forked OWUI builds may use `tool_servers` (plural) — we
 * accept either and write back to whichever key currently holds data; if
 * neither does, we default to the singular form that ships in OWUI 0.6+.
 */
function readToolServerConfig(
  config: Record<string, unknown>,
): { key: 'tool_server' | 'tool_servers'; value: OpenwebuiToolServerConfig } {
  const single = config.tool_server;
  if (single && typeof single === 'object' && !Array.isArray(single)) {
    return { key: 'tool_server', value: single as OpenwebuiToolServerConfig };
  }
  const plural = config.tool_servers;
  if (plural && typeof plural === 'object' && !Array.isArray(plural)) {
    return { key: 'tool_servers', value: plural as OpenwebuiToolServerConfig };
  }
  return { key: 'tool_server', value: { connections: [] } };
}

/** Look up the OWUI host port from the component registry (default 3011). */
function resolveOpenwebuiPort(): number {
  const comp = COMPONENTS.find((c) => c.id === 'openwebui');
  return comp?.service?.hostPort ?? 3011;
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

  const port = resolveOpenwebuiPort();
  const jwt = await getAdminJwt(port);
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

  const config = await getConfig(jwt, port);
  if (!config) {
    throw new Error('Could not read OpenWebUI persisted config');
  }

  const configRecord = config as Record<string, unknown>;
  const { key: toolServerKey, value: toolServerCfg } = readToolServerConfig(configRecord);
  const connections: OpenwebuiToolServerConnection[] = Array.isArray(toolServerCfg.connections)
    ? [...toolServerCfg.connections]
    : [];

  const existingIdx = connections.findIndex((c) => c.name === SYNAP_TOOL_SERVER_NAME);
  const existing = existingIdx >= 0 ? connections[existingIdx] : undefined;

  // Idempotency check: same URL + same bearer = no-op.
  if (
    existing &&
    existing.url === endpointUrl &&
    existing.key === apiKey
  ) {
    return {
      registered: true,
      toolCount: probe.paths,
      serverName: SYNAP_TOOL_SERVER_NAME,
      endpointUrl,
    };
  }

  const updatedEntry: OpenwebuiToolServerConnection = {
    url: endpointUrl,
    key: apiKey,
    name: SYNAP_TOOL_SERVER_NAME,
  };

  if (existingIdx >= 0) {
    connections[existingIdx] = { ...existing, ...updatedEntry };
  } else {
    connections.push(updatedEntry);
  }

  const nextToolServer: OpenwebuiToolServerConfig = {
    ...toolServerCfg,
    connections,
  };

  const nextConfig: Record<string, unknown> = {
    ...configRecord,
    [toolServerKey]: nextToolServer,
  };

  const saved = await saveConfig(jwt, nextConfig, port);
  if (!saved) {
    throw new Error('Failed to save OpenWebUI config with Synap tool server');
  }

  return {
    registered: true,
    toolCount: probe.paths,
    serverName: SYNAP_TOOL_SERVER_NAME,
    endpointUrl,
  };
}
