/**
 * Hub Protocol diagnostics — framework-agnostic probes against a Synap pod.
 *
 * Two callers consume this module:
 *   - Dashboard `lib/doctor.ts` → maps results into its own `Check[]` shape
 *   - CLI `eve doctor` → renders results inline next to its existing checks
 *
 * Why it lives here, not in the dashboard or CLI:
 *   - The CLI used to ship without these probes; users running diagnostics
 *     from a server console couldn't see idempotency / SSE / sub-token
 *     state. Lifting the probes into a shared package gives both surfaces
 *     the same coverage.
 *   - The dashboard's copy was 600+ lines tangled with React/Next.js code
 *     paths (`group: "ai"`, `componentId`, `repair` button hints). The
 *     shared module emits a neutral `HubProtocolDiagnostic` and lets each
 *     surface map it to whatever shape it renders.
 *
 * Constraints honored here:
 *   - Built-in fetch + ReadableStream + node:crypto only. No new deps.
 *   - All probes have hard timeouts (4–35s). A stuck pod can't hang
 *     `eve doctor` forever.
 *   - SSE probe cleans up the reader + AbortController in a `finally`
 *     block — leaking SSE connections would slowly burn fds on the
 *     dashboard server.
 *   - The "skip" status is deliberate: missing API key isn't a failure,
 *     it's a state. Both surfaces need to distinguish them visually.
 */

import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ProbeStatus = "pass" | "fail" | "skip";

export type HubProtocolProbeId =
  | "hub-protocol-openapi"
  | "hub-protocol-idempotency"
  | "hub-protocol-events"
  | "hub-protocol-sub-tokens";

export interface HubProtocolDiagnostic {
  id: HubProtocolProbeId;
  /** Human-readable label, e.g. "Synap Hub Protocol". Stable across surfaces. */
  name: string;
  status: ProbeStatus;
  message: string;
  /** Optional one-line repair hint shown next to the row in both surfaces. */
  fix?: string;
  /** Wall-clock duration in ms — useful for telemetry / "this probe is slow" UX. */
  durationMs: number;
}

export interface RunHubProtocolProbesOptions {
  /** Synap pod base URL (e.g. `https://pod.example.com`). Trailing slashes stripped. */
  synapUrl: string;
  /** Bearer token for Hub Protocol calls. Empty string → all probes skip. */
  apiKey: string;
  /** Optional outer abort signal (caller cancellation). Each probe still has its own timeout. */
  signal?: AbortSignal;
  /**
   * HTTP runner. Controls how probes reach the pod. Defaults to `FetchRunner`
   * which uses native `fetch()` and works in any environment with direct
   * network access (dev, dashboard server, container with mapped port).
   *
   * The CLI passes a `FallbackRunner` that swaps to a docker-exec-based
   * runner when the host loopback isn't reachable — a common case on
   * Eve deployments where synap-backend has no host port mapping and is
   * only addressable via container DNS inside `eve-network`. See
   * `packages/eve-cli/src/lib/doctor-runners.ts`.
   */
  runner?: IDoctorRunner;
  /**
   * Optional one-shot notification hook. Fires once per run if the runner
   * dynamically switches transport mid-run (e.g. host fetch fails →
   * docker exec). Callers wire this to a log line so users know why the
   * probes are still working despite the unreachable URL.
   */
  onRunnerNote?: (note: string) => void;
}

/**
 * Pluggable HTTP transport for Hub Protocol probes. Two impls ship with
 * Eve: `FetchRunner` (native fetch — default, used by dashboard) and
 * `DockerExecRunner` (CLI-side, runs `wget` from inside `eve-legs-traefik`).
 *
 * The runner abstraction exists so the framework-agnostic diagnostics
 * module doesn't have to depend on `execa`/`child_process` — that
 * dependency lives only in the CLI side. Callers that don't need
 * docker-exec fallback can ignore the parameter and get fetch.
 */
export interface IDoctorRunner {
  /**
   * Single request/response GET. Returns the parsed status, headers, and
   * body as a string. NEVER throws on HTTP error codes — only for
   * transport failures (DNS, connection refused, timeout). Transport
   * errors throw with `name === "TransportError"` and a `code` property
   * that callers can use to decide on fallback.
   */
  httpGet(
    url: string,
    headers: Record<string, string>,
    opts?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<DoctorRunnerResponse>;

  /**
   * Single request/response POST. Same semantics as `httpGet`. The body
   * is sent verbatim — caller is responsible for stringifying JSON.
   */
  httpPost(
    url: string,
    headers: Record<string, string>,
    body: string,
    opts?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<DoctorRunnerResponse>;

  /**
   * Single request/response DELETE. Best-effort cleanup helper — the
   * idempotency probe uses this to remove the throwaway entity.
   */
  httpDelete(
    url: string,
    headers: Record<string, string>,
    opts?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<DoctorRunnerResponse>;

  /**
   * Streaming GET — the SSE probe uses this. The runner returns an
   * AsyncIterable of UTF-8 string chunks (already decoded). Callers
   * iterate until they see what they need, then break (which closes
   * the underlying stream / kills the subprocess).
   *
   * Some runners (DockerExec) can't easily support true streaming and
   * may buffer up to N bytes before yielding — that's still good enough
   * for an SSE heartbeat probe, where the heartbeat lands within the
   * first frame. Runners that can't stream at all should return
   * `{ ok: false, status: 0, error: "stream-not-supported" }` and let
   * the caller skip the probe gracefully.
   */
  httpStream(
    url: string,
    headers: Record<string, string>,
    opts?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<DoctorRunnerStream>;

  /**
   * Optional human-readable name shown in logs when the runner is in
   * use ("fetch", "docker-exec", "fallback"). Used by `onRunnerNote`.
   */
  readonly name: string;
}

export interface DoctorRunnerResponse {
  /** HTTP status code. 0 means transport failure (no HTTP response at all). */
  status: number;
  /** Response body as a string (may be empty). */
  body: string;
  /** Lowercased response header name → value. */
  headers: Record<string, string>;
  /** Set when status === 0 — the transport-level error message. */
  error?: string;
}

export interface DoctorRunnerStream {
  /** True when the request opened successfully. False → `error` is set. */
  ok: boolean;
  status: number;
  /** Lowercased response header name → value. Populated when `ok === true`. */
  headers: Record<string, string>;
  /** Decoded UTF-8 chunks, yielded as they arrive. Only present when `ok === true`. */
  chunks?: AsyncIterable<string>;
  /** Always callable — closes the underlying stream / aborts the request. */
  close: () => Promise<void>;
  /** Set when `ok === false` — the transport-level error message. */
  error?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OPENAPI_TIMEOUT_MS = 4_000;
const ENTITY_POST_TIMEOUT_MS = 6_000;
const SSE_TIMEOUT_MS = 35_000;
const ME_TIMEOUT_MS = 6_000;
const DELETE_TIMEOUT_MS = 4_000;

const OPENAPI_NAME = "Synap Hub Protocol";
const IDEMPOTENCY_NAME = "Synap idempotency replay";
const EVENTS_NAME = "Synap event stream";
const SUB_TOKENS_NAME = "Synap sub-token mode";

// ---------------------------------------------------------------------------
// Aggregator — runs all four probes
// ---------------------------------------------------------------------------

/**
 * Run the full Hub Protocol probe suite against a pod.
 *
 * Order is deliberate: the OpenAPI probe runs first because if it fails the
 * other three would all report misleading errors (e.g. "404 on /api/hub/...").
 * If OpenAPI fails or skips, we still emit the other three with skip status
 * so callers get a stable result shape — they always have four rows to
 * render, regardless of why they were skipped.
 *
 * The three follow-up probes run in parallel — the SSE probe alone is up to
 * 35s, so serial would be ~36s+ vs ~35s parallel.
 */
export async function runHubProtocolProbes(
  opts: RunHubProtocolProbesOptions,
): Promise<HubProtocolDiagnostic[]> {
  const synapUrl = opts.synapUrl.replace(/\/+$/, "");
  const apiKey = opts.apiKey;
  const signal = opts.signal;
  const runner = opts.runner ?? new FetchRunner();
  const onRunnerNote = opts.onRunnerNote;

  const openapi = await probeOpenapi(runner, synapUrl, apiKey, signal, onRunnerNote);

  // If OpenAPI didn't pass, the other probes have no chance — skip them
  // but still emit rows so the renderer doesn't have to special-case
  // "partial result" shapes.
  if (openapi.status !== "pass") {
    const skipMsg = openapi.status === "skip"
      ? "Skipped — Synap URL or API key missing"
      : `Skipped — ${OPENAPI_NAME} probe didn't pass`;

    return [
      openapi,
      skipDiag("hub-protocol-idempotency", IDEMPOTENCY_NAME, skipMsg),
      skipDiag("hub-protocol-events", EVENTS_NAME, skipMsg),
      skipDiag("hub-protocol-sub-tokens", SUB_TOKENS_NAME, skipMsg),
    ];
  }

  const [idem, sse, subTokens] = await Promise.all([
    probeIdempotency(runner, synapUrl, apiKey, signal),
    probeEventStream(runner, synapUrl, apiKey, signal),
    probeSubTokens(runner, synapUrl, apiKey, signal),
  ]);

  return [openapi, idem, sse, subTokens];
}

// ---------------------------------------------------------------------------
// Probe 1 — OpenAPI / Hub Protocol reachability
// ---------------------------------------------------------------------------

async function probeOpenapi(
  runner: IDoctorRunner,
  synapUrl: string,
  apiKey: string,
  outer?: AbortSignal,
  onRunnerNote?: (note: string) => void,
): Promise<HubProtocolDiagnostic> {
  const start = Date.now();

  if (!synapUrl) {
    return {
      id: "hub-protocol-openapi",
      name: OPENAPI_NAME,
      status: "skip",
      message: "Synap apiUrl not configured in secrets",
      fix: "Re-run setup or open the AI page → Save",
      durationMs: Date.now() - start,
    };
  }
  if (!apiKey) {
    return {
      id: "hub-protocol-openapi",
      name: OPENAPI_NAME,
      status: "skip",
      message: "Synap API key missing — Hub Protocol probe needs Bearer auth",
      fix: "Re-install Synap (`eve add synap`) to provision an API key",
      durationMs: Date.now() - start,
    };
  }

  const url = `${synapUrl}/api/hub/openapi.json`;
  const headers = { Authorization: `Bearer ${apiKey}`, Accept: "application/json" };

  // The opening probe is the place where the runner decides to swap
  // transports. Pass the note hook in so a `FallbackRunner` can announce
  // the swap once and only once.
  const res = await runner.httpGet(url, headers, { signal: outer, timeoutMs: OPENAPI_TIMEOUT_MS });

  // Surface the runner's name change after the call, in case the runner
  // self-reports through `onRunnerNote` at construction or after a swap.
  // (FallbackRunner emits its own notes via the hook directly; we don't
  // duplicate them here.)
  void onRunnerNote;

  if (res.status === 0) {
    return {
      id: "hub-protocol-openapi",
      name: OPENAPI_NAME,
      status: "fail",
      message: `Cannot reach Synap backend at ${synapUrl} (${res.error ?? "network error"})`,
      fix: "Check the Synap container is running and the URL is reachable",
      durationMs: Date.now() - start,
    };
  }

  if (res.status === 401 || res.status === 403) {
    return {
      id: "hub-protocol-openapi",
      name: OPENAPI_NAME,
      status: "fail",
      message: `API key missing or wrong scopes — ${res.status} from ${url}`,
      fix: "Re-run setup to mint a fresh agent API key",
      durationMs: Date.now() - start,
    };
  }
  if (res.status === 404) {
    return {
      id: "hub-protocol-openapi",
      name: OPENAPI_NAME,
      status: "fail",
      message: "Hub Protocol not available — backend version too old (404 on /api/hub/openapi.json)",
      fix: "Update Synap (`eve update synap`)",
      durationMs: Date.now() - start,
    };
  }
  if (res.status < 200 || res.status >= 300) {
    return {
      id: "hub-protocol-openapi",
      name: OPENAPI_NAME,
      status: "fail",
      message: `Hub Protocol returned ${res.status} from ${url}`,
      durationMs: Date.now() - start,
    };
  }

  let body: unknown;
  try {
    body = JSON.parse(res.body);
  } catch {
    return {
      id: "hub-protocol-openapi",
      name: OPENAPI_NAME,
      status: "fail",
      message: "Endpoint returned unexpected payload (not JSON) — likely a proxy error page",
      durationMs: Date.now() - start,
    };
  }

  const openapi = (body as { openapi?: unknown })?.openapi;
  if (typeof openapi !== "string" || openapi.length === 0) {
    return {
      id: "hub-protocol-openapi",
      name: OPENAPI_NAME,
      status: "fail",
      message: "Hub Protocol older than 2026-05 — update synap-backend (no openapi field in response)",
      fix: "Update Synap (`eve update synap`)",
      durationMs: Date.now() - start,
    };
  }
  if (!openapi.startsWith("3.")) {
    return {
      id: "hub-protocol-openapi",
      name: OPENAPI_NAME,
      status: "fail",
      message: `Hub Protocol returned an unexpected OpenAPI version (${openapi}) — expected 3.x`,
      durationMs: Date.now() - start,
    };
  }

  return {
    id: "hub-protocol-openapi",
    name: OPENAPI_NAME,
    status: "pass",
    message: `Reachable; OpenAPI ${openapi}`,
    durationMs: Date.now() - start,
  };
}

// ---------------------------------------------------------------------------
// Probe 2 — Idempotency replay
// ---------------------------------------------------------------------------

async function probeIdempotency(
  runner: IDoctorRunner,
  synapUrl: string,
  apiKey: string,
  outer?: AbortSignal,
): Promise<HubProtocolDiagnostic> {
  const start = Date.now();

  if (!synapUrl || !apiKey) {
    return skipDiag("hub-protocol-idempotency", IDEMPOTENCY_NAME, "Skipped — Synap URL or API key missing");
  }

  const url = `${synapUrl}/api/hub/entities`;
  const idempotencyKey = randomUUID();
  const body = {
    profileSlug: "note",
    title: "eve-doctor-idempotency-smoke",
    source: "openwebui-pipeline",
  };
  const bodyJson = JSON.stringify(body);
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    "Idempotency-Key": idempotencyKey,
  };

  const post = () => runner.httpPost(url, headers, bodyJson, {
    signal: outer,
    timeoutMs: ENTITY_POST_TIMEOUT_MS,
  });

  const first = await post();
  if (first.status === 0) {
    return {
      id: "hub-protocol-idempotency",
      name: IDEMPOTENCY_NAME,
      status: "fail",
      message: `Cannot reach ${url} (${first.error ?? "network error"})`,
      fix: "Check the Synap container is running and the URL is reachable",
      durationMs: Date.now() - start,
    };
  }
  if (first.status === 401 || first.status === 403) {
    return {
      id: "hub-protocol-idempotency",
      name: IDEMPOTENCY_NAME,
      status: "fail",
      message: `API key rejected — ${first.status} from POST /api/hub/entities`,
      fix: "Re-run setup to mint a fresh agent API key",
      durationMs: Date.now() - start,
    };
  }
  if (first.status === 404) {
    return {
      id: "hub-protocol-idempotency",
      name: IDEMPOTENCY_NAME,
      status: "fail",
      message: "POST /api/hub/entities not available — backend version too old",
      fix: "Update Synap (`eve update synap`)",
      durationMs: Date.now() - start,
    };
  }
  if (first.status < 200 || first.status >= 300) {
    return {
      id: "hub-protocol-idempotency",
      name: IDEMPOTENCY_NAME,
      status: "fail",
      message: `First POST returned ${first.status}: ${truncate(first.body)}`,
      durationMs: Date.now() - start,
    };
  }

  const second = await post();
  if (second.status === 0) {
    return {
      id: "hub-protocol-idempotency",
      name: IDEMPOTENCY_NAME,
      status: "fail",
      message: `Second POST failed (${second.error ?? "network error"}) — couldn't verify replay`,
      durationMs: Date.now() - start,
    };
  }
  if (second.status < 200 || second.status >= 300) {
    return {
      id: "hub-protocol-idempotency",
      name: IDEMPOTENCY_NAME,
      status: "fail",
      message: `Second POST returned ${second.status}: ${truncate(second.body)}`,
      durationMs: Date.now() - start,
    };
  }

  // Best-effort cleanup BEFORE we judge — if both calls returned the same
  // entity id we only need to delete it once.
  const entityId = extractEntityId(first.body);
  if (entityId) {
    void deleteEntityBestEffort(synapUrl, apiKey, entityId, runner);
  }

  // Header lookup is case-insensitive at the runner layer (lowercase keys).
  const replayHeader = second.headers["x-idempotent-replay"];
  if (replayHeader !== "true") {
    return {
      id: "hub-protocol-idempotency",
      name: IDEMPOTENCY_NAME,
      status: "fail",
      message: "Backend doesn't echo X-Idempotent-Replay — idempotency middleware not mounted",
      fix: "Update Synap (`eve update synap`) — needs 2026-05+ Hub Protocol",
      durationMs: Date.now() - start,
    };
  }

  if (first.body !== second.body) {
    return {
      id: "hub-protocol-idempotency",
      name: IDEMPOTENCY_NAME,
      status: "fail",
      message: "Backend created a duplicate entity (idempotency middleware not honouring the key)",
      fix: "Update Synap (`eve update synap`) — needs 2026-05+ Hub Protocol",
      durationMs: Date.now() - start,
    };
  }

  return {
    id: "hub-protocol-idempotency",
    name: IDEMPOTENCY_NAME,
    status: "pass",
    message: "Replay confirmed — same Idempotency-Key returns the cached response",
    durationMs: Date.now() - start,
  };
}

// ---------------------------------------------------------------------------
// Probe 3 — SSE event stream heartbeat
// ---------------------------------------------------------------------------

async function probeEventStream(
  runner: IDoctorRunner,
  synapUrl: string,
  apiKey: string,
  outer?: AbortSignal,
): Promise<HubProtocolDiagnostic> {
  const start = Date.now();

  if (!synapUrl || !apiKey) {
    return skipDiag("hub-protocol-events", EVENTS_NAME, "Skipped — Synap URL or API key missing");
  }

  const url = `${synapUrl}/api/hub/events/stream`;
  const headers = { Authorization: `Bearer ${apiKey}`, Accept: "text/event-stream" };
  const stream = await runner.httpStream(url, headers, { signal: outer, timeoutMs: SSE_TIMEOUT_MS });

  if (!stream.ok) {
    if (stream.error === "stream-not-supported") {
      return skipDiag(
        "hub-protocol-events",
        EVENTS_NAME,
        "Skipped — SSE probing not supported by current runner (e.g. docker-exec wget without unbuffered piping)",
      );
    }
    if (stream.status === 401 || stream.status === 403) {
      return {
        id: "hub-protocol-events",
        name: EVENTS_NAME,
        status: "fail",
        message: `API key rejected on /api/hub/events/stream (${stream.status})`,
        fix: "Re-run setup to mint a fresh agent API key",
        durationMs: Date.now() - start,
      };
    }
    if (stream.status === 404) {
      return {
        id: "hub-protocol-events",
        name: EVENTS_NAME,
        status: "fail",
        message: "GET /api/hub/events/stream not available — backend version too old",
        fix: "Update Synap (`eve update synap`)",
        durationMs: Date.now() - start,
      };
    }
    if (stream.status === 0) {
      const aborted = stream.error?.toLowerCase().includes("abort") || stream.error?.toLowerCase().includes("timeout");
      return {
        id: "hub-protocol-events",
        name: EVENTS_NAME,
        status: "fail",
        message: aborted
          ? `No SSE response within ${SSE_TIMEOUT_MS / 1000}s — proxy may be killing the stream`
          : `Cannot open event stream at ${url} (${stream.error ?? "network error"})`,
        fix: aborted
          ? "Check reverse-proxy buffering: nginx needs `proxy_buffering off` for SSE"
          : "Check the Synap container is running",
        durationMs: Date.now() - start,
      };
    }
    return {
      id: "hub-protocol-events",
      name: EVENTS_NAME,
      status: "fail",
      message: `Event stream returned ${stream.status} (${stream.error ?? "no body"})`,
      durationMs: Date.now() - start,
    };
  }

  let received = false;
  let receivedKind = "";
  let buffer = "";
  let readError: Error | null = null;

  try {
    if (stream.chunks) {
      for await (const chunk of stream.chunks) {
        buffer += chunk;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith("event:")) {
            const kind = trimmed.slice(6).trim();
            if (kind === "heartbeat" || kind === "event") {
              received = true;
              receivedKind = kind;
              break;
            }
          }
        }
        if (received) break;
      }
    }
  } catch (err) {
    if (!(err instanceof Error && err.name === "AbortError")) {
      readError = err instanceof Error ? err : new Error(String(err));
    }
  } finally {
    await stream.close();
  }

  if (readError) {
    return {
      id: "hub-protocol-events",
      name: EVENTS_NAME,
      status: "fail",
      message: `Stream read error: ${readError.message}`,
      durationMs: Date.now() - start,
    };
  }

  if (!received) {
    return {
      id: "hub-protocol-events",
      name: EVENTS_NAME,
      status: "fail",
      message: `No heartbeat received within ${SSE_TIMEOUT_MS / 1000}s — stream may be proxied without flush`,
      fix: "Check reverse-proxy: SSE needs `proxy_buffering off` and no response gzip",
      durationMs: Date.now() - start,
    };
  }

  return {
    id: "hub-protocol-events",
    name: EVENTS_NAME,
    status: "pass",
    message: `Stream open — received \`${receivedKind}\` frame within ${SSE_TIMEOUT_MS / 1000}s`,
    durationMs: Date.now() - start,
  };
}

// ---------------------------------------------------------------------------
// Probe 4 — Sub-token round-trip
// ---------------------------------------------------------------------------

async function probeSubTokens(
  runner: IDoctorRunner,
  synapUrl: string,
  apiKey: string,
  outer?: AbortSignal,
): Promise<HubProtocolDiagnostic> {
  const start = Date.now();

  if (!synapUrl || !apiKey) {
    return skipDiag("hub-protocol-sub-tokens", SUB_TOKENS_NAME, "Skipped — Synap URL or API key missing");
  }

  const url = `${synapUrl}/api/hub/users/me`;
  const externalUserId = `eve-doctor-smoke-${Date.now()}`;

  const fetchMe = async (extraHeaders: Record<string, string>): Promise<
    | { ok: true; userId: string | null; status: number }
    | { ok: false; status: number; message: string }
  > => {
    const res = await runner.httpGet(
      url,
      {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        ...extraHeaders,
      },
      { signal: outer, timeoutMs: ME_TIMEOUT_MS },
    );
    if (res.status === 0) {
      return {
        ok: false,
        status: 0,
        message: res.error ?? "network error",
      };
    }
    if (res.status < 200 || res.status >= 300) {
      return { ok: false, status: res.status, message: truncate(res.body) };
    }
    let id: string | null = null;
    try {
      const parsed = JSON.parse(res.body) as Record<string, unknown>;
      const candidate = parsed.id ?? (parsed.user as Record<string, unknown> | undefined)?.id;
      if (typeof candidate === "string") id = candidate;
    } catch {
      return { ok: false, status: res.status, message: "response was not JSON" };
    }
    return { ok: true, userId: id, status: res.status };
  };

  const parent = await fetchMe({});
  if (!parent.ok) {
    if (parent.status === 401 || parent.status === 403) {
      return {
        id: "hub-protocol-sub-tokens",
        name: SUB_TOKENS_NAME,
        status: "fail",
        message: `API key rejected on /api/hub/users/me (${parent.status})`,
        fix: "Re-run setup to mint a fresh agent API key",
        durationMs: Date.now() - start,
      };
    }
    if (parent.status === 404) {
      return {
        id: "hub-protocol-sub-tokens",
        name: SUB_TOKENS_NAME,
        status: "fail",
        message: "GET /api/hub/users/me not available — backend version too old",
        fix: "Update Synap (`eve update synap`)",
        durationMs: Date.now() - start,
      };
    }
    return {
      id: "hub-protocol-sub-tokens",
      name: SUB_TOKENS_NAME,
      status: "fail",
      message: `Couldn't fetch parent user (${parent.status || "network error"}): ${parent.message}`,
      durationMs: Date.now() - start,
    };
  }
  if (!parent.userId) {
    return {
      id: "hub-protocol-sub-tokens",
      name: SUB_TOKENS_NAME,
      status: "fail",
      message: "Backend returned /users/me without an id field",
      durationMs: Date.now() - start,
    };
  }

  const sub = await fetchMe({ "X-External-User-Id": externalUserId });
  if (!sub.ok) {
    return {
      id: "hub-protocol-sub-tokens",
      name: SUB_TOKENS_NAME,
      status: "fail",
      message: `Couldn't fetch user with X-External-User-Id (${sub.status || "network error"}): ${sub.message}`,
      durationMs: Date.now() - start,
    };
  }
  if (!sub.userId) {
    return {
      id: "hub-protocol-sub-tokens",
      name: SUB_TOKENS_NAME,
      status: "fail",
      message: "Backend returned /users/me without an id field on sub-token call",
      durationMs: Date.now() - start,
    };
  }

  if (parent.userId === sub.userId) {
    // Header ignored — this is the EXPECTED state when
    // HUB_PROTOCOL_SUB_TOKENS=false. Multi-user mode is opt-in, so we
    // surface this as "skip" — informational, not a failure.
    return {
      id: "hub-protocol-sub-tokens",
      name: SUB_TOKENS_NAME,
      status: "skip",
      message: "Multi-user mode: OFF — X-External-User-Id ignored (HUB_PROTOCOL_SUB_TOKENS=false)",
      durationMs: Date.now() - start,
    };
  }

  return {
    id: "hub-protocol-sub-tokens",
    name: SUB_TOKENS_NAME,
    status: "pass",
    message: `Multi-user mode: ON — sub-token resolved to a separate user id (parent=${shortId(parent.userId)}, sub=${shortId(sub.userId)})`,
    durationMs: Date.now() - start,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function skipDiag(id: HubProtocolProbeId, name: string, message: string): HubProtocolDiagnostic {
  return { id, name, status: "skip", message, durationMs: 0 };
}

/** Truncate response bodies so error messages stay readable in the UI. */
export function truncate(text: string, max = 160): string {
  const oneline = text.replace(/\s+/g, " ").trim();
  return oneline.length > max ? `${oneline.slice(0, max)}…` : oneline;
}

/** Last 8 chars of an id for display — full UUIDs are noise in messages. */
export function shortId(id: string): string {
  return id.length > 8 ? `…${id.slice(-8)}` : id;
}

/** Pull `id` out of an entity-create response without throwing. */
export function extractEntityId(text: string): string | null {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const direct = parsed.id;
    if (typeof direct === "string") return direct;
    const nested = (parsed.entity as Record<string, unknown> | undefined)?.id;
    if (typeof nested === "string") return nested;
    return null;
  } catch {
    return null;
  }
}

/**
 * Fire-and-forget DELETE — failures are silently ignored. Routes through
 * the same runner as the calling probe so docker-exec mode also cleans up
 * its throwaway entities. When called without a runner (legacy callers,
 * tests), falls back to a fresh `FetchRunner`.
 */
export async function deleteEntityBestEffort(
  synapUrl: string,
  apiKey: string,
  entityId: string,
  runner?: IDoctorRunner,
): Promise<void> {
  const r = runner ?? new FetchRunner();
  try {
    await r.httpDelete(
      `${synapUrl}/api/hub/entities/${encodeURIComponent(entityId)}`,
      { Authorization: `Bearer ${apiKey}` },
      { timeoutMs: DELETE_TIMEOUT_MS },
    );
  } catch {
    // Cleanup is best-effort. The throwaway entity is identifiable by its
    // `eve-doctor-idempotency-smoke` title if a user wants to remove it
    // manually. A failed cleanup must NOT demote the probe — that would
    // confuse "your idempotency works" with "you can't delete entities".
  }
}

/**
 * Combine an outer abort signal with a per-probe timeout. Returns a fresh
 * AbortController whose signal trips when EITHER fires. The `cleanup`
 * function clears the timeout AND removes the outer-signal listener so we
 * don't leak listeners across many probes within the same caller signal.
 */
export function combineSignals(outer: AbortSignal | undefined, timeoutMs: number): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);

  let onAbort: (() => void) | null = null;
  if (outer) {
    if (outer.aborted) {
      ac.abort();
    } else {
      onAbort = () => ac.abort();
      outer.addEventListener("abort", onAbort);
    }
  }

  return {
    signal: ac.signal,
    cleanup: () => {
      clearTimeout(timer);
      if (onAbort && outer) outer.removeEventListener("abort", onAbort);
    },
  };
}

// ---------------------------------------------------------------------------
// FetchRunner — default IDoctorRunner using the platform's native fetch.
// Works in any environment with direct network access (dev, dashboard
// server, container with mapped port). Used by the dashboard exclusively;
// the CLI uses `FallbackRunner` (in `packages/eve-cli/src/lib/doctor-runners.ts`)
// which falls through to a docker-exec-based runner when host fetch fails.
// ---------------------------------------------------------------------------

/** Lowercase headers from a Fetch `Response` into a plain record. */
function headersToRecord(h: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  h.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

/**
 * Detect transport-level errors that should trigger fallback to a different
 * runner. The CLI's `FallbackRunner` calls this on every fetch error. The
 * exact set: connection-refused / DNS failure / host-unreachable. Anything
 * else (HTTP 5xx, JSON parse error, etc.) is a real failure to report,
 * not a runner-mismatch problem.
 */
export function isFetchTransportError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  // Node fetch wraps the underlying error: `cause.code` is the useful bit.
  const cause = (err as { cause?: { code?: string } }).cause;
  const code = cause?.code;
  if (code === "ECONNREFUSED" || code === "EHOSTUNREACH" || code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return true;
  }
  // Some platforms surface the code in the message instead of the cause.
  // Match conservatively — only the codes above, never broad substrings
  // like "fetch failed" alone (which happens on plain HTTP errors too).
  const msg = err.message || "";
  return /\bECONNREFUSED\b|\bEHOSTUNREACH\b|\bENOTFOUND\b/.test(msg);
}

export class FetchRunner implements IDoctorRunner {
  readonly name = "fetch";

  async httpGet(
    url: string,
    headers: Record<string, string>,
    opts: { signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<DoctorRunnerResponse> {
    return this.request("GET", url, headers, undefined, opts);
  }

  async httpPost(
    url: string,
    headers: Record<string, string>,
    body: string,
    opts: { signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<DoctorRunnerResponse> {
    return this.request("POST", url, headers, body, opts);
  }

  async httpDelete(
    url: string,
    headers: Record<string, string>,
    opts: { signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<DoctorRunnerResponse> {
    return this.request("DELETE", url, headers, undefined, opts);
  }

  private async request(
    method: string,
    url: string,
    headers: Record<string, string>,
    body: string | undefined,
    opts: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<DoctorRunnerResponse> {
    const ac = combineSignals(opts.signal, opts.timeoutMs ?? 6_000);
    try {
      const res = await fetch(url, {
        method,
        headers,
        body,
        signal: ac.signal,
      });
      const text = await res.text();
      return {
        status: res.status,
        body: text,
        headers: headersToRecord(res.headers),
      };
    } catch (err) {
      return {
        status: 0,
        body: "",
        headers: {},
        error: err instanceof Error ? err.message : "network error",
      };
    } finally {
      ac.cleanup();
    }
  }

  async httpStream(
    url: string,
    headers: Record<string, string>,
    opts: { signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<DoctorRunnerStream> {
    const ac = combineSignals(opts.signal, opts.timeoutMs ?? 35_000);

    let res: Response;
    try {
      res = await fetch(url, { method: "GET", headers, signal: ac.signal });
    } catch (err) {
      ac.cleanup();
      return {
        ok: false,
        status: 0,
        headers: {},
        close: async () => { /* nothing to close */ },
        error: err instanceof Error ? err.message : "network error",
      };
    }

    if (!res.ok || !res.body) {
      // Drain to free the connection. Body might still be a stream we
      // need to cancel; a fresh attempt to read it post-cleanup is fine.
      try { await res.body?.cancel(); } catch { /* ignore */ }
      ac.cleanup();
      return {
        ok: false,
        status: res.status,
        headers: headersToRecord(res.headers),
        close: async () => { /* already closed */ },
        error: res.body ? undefined : "no body",
      };
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    async function* iterate(): AsyncGenerator<string> {
      while (true) {
        const { done, value } = await reader.read();
        if (done) return;
        if (value) yield decoder.decode(value, { stream: true });
      }
    }

    const close = async () => {
      try { await reader.cancel(); } catch { /* ignore */ }
      ac.cleanup();
    };

    return {
      ok: true,
      status: res.status,
      headers: headersToRecord(res.headers),
      chunks: iterate(),
      close,
    };
  }
}
