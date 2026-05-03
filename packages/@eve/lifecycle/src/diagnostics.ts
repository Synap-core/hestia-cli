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

  const openapi = await probeOpenapi(synapUrl, apiKey, signal);

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
    probeIdempotency(synapUrl, apiKey, signal),
    probeEventStream(synapUrl, apiKey, signal),
    probeSubTokens(synapUrl, apiKey, signal),
  ]);

  return [openapi, idem, sse, subTokens];
}

// ---------------------------------------------------------------------------
// Probe 1 — OpenAPI / Hub Protocol reachability
// ---------------------------------------------------------------------------

async function probeOpenapi(
  synapUrl: string,
  apiKey: string,
  outer?: AbortSignal,
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
  const ac = combineSignals(outer, OPENAPI_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      signal: ac.signal,
    });
  } catch (err) {
    return {
      id: "hub-protocol-openapi",
      name: OPENAPI_NAME,
      status: "fail",
      message: `Cannot reach Synap backend at ${synapUrl} (${err instanceof Error ? err.message : "network error"})`,
      fix: "Check the Synap container is running and the URL is reachable",
      durationMs: Date.now() - start,
    };
  } finally {
    ac.cleanup();
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
  if (!res.ok) {
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
    body = await res.json();
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

  const post = async (): Promise<{ res: Response; text: string } | { error: string }> => {
    const ac = combineSignals(outer, ENTITY_POST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: bodyJson,
        signal: ac.signal,
      });
      const text = await res.text();
      return { res, text };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "network error" };
    } finally {
      ac.cleanup();
    }
  };

  const first = await post();
  if ("error" in first) {
    return {
      id: "hub-protocol-idempotency",
      name: IDEMPOTENCY_NAME,
      status: "fail",
      message: `Cannot reach ${url} (${first.error})`,
      fix: "Check the Synap container is running and the URL is reachable",
      durationMs: Date.now() - start,
    };
  }
  if (first.res.status === 401 || first.res.status === 403) {
    return {
      id: "hub-protocol-idempotency",
      name: IDEMPOTENCY_NAME,
      status: "fail",
      message: `API key rejected — ${first.res.status} from POST /api/hub/entities`,
      fix: "Re-run setup to mint a fresh agent API key",
      durationMs: Date.now() - start,
    };
  }
  if (first.res.status === 404) {
    return {
      id: "hub-protocol-idempotency",
      name: IDEMPOTENCY_NAME,
      status: "fail",
      message: "POST /api/hub/entities not available — backend version too old",
      fix: "Update Synap (`eve update synap`)",
      durationMs: Date.now() - start,
    };
  }
  if (!first.res.ok) {
    return {
      id: "hub-protocol-idempotency",
      name: IDEMPOTENCY_NAME,
      status: "fail",
      message: `First POST returned ${first.res.status}: ${truncate(first.text)}`,
      durationMs: Date.now() - start,
    };
  }

  const second = await post();
  if ("error" in second) {
    return {
      id: "hub-protocol-idempotency",
      name: IDEMPOTENCY_NAME,
      status: "fail",
      message: `Second POST failed (${second.error}) — couldn't verify replay`,
      durationMs: Date.now() - start,
    };
  }
  if (!second.res.ok) {
    return {
      id: "hub-protocol-idempotency",
      name: IDEMPOTENCY_NAME,
      status: "fail",
      message: `Second POST returned ${second.res.status}: ${truncate(second.text)}`,
      durationMs: Date.now() - start,
    };
  }

  // Best-effort cleanup BEFORE we judge — if both calls returned the same
  // entity id we only need to delete it once.
  const entityId = extractEntityId(first.text);
  if (entityId) {
    void deleteEntityBestEffort(synapUrl, apiKey, entityId);
  }

  const replayHeader = second.res.headers.get("X-Idempotent-Replay")
    ?? second.res.headers.get("x-idempotent-replay");
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

  if (first.text !== second.text) {
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
  synapUrl: string,
  apiKey: string,
  outer?: AbortSignal,
): Promise<HubProtocolDiagnostic> {
  const start = Date.now();

  if (!synapUrl || !apiKey) {
    return skipDiag("hub-protocol-events", EVENTS_NAME, "Skipped — Synap URL or API key missing");
  }

  const url = `${synapUrl}/api/hub/events/stream`;
  const ac = combineSignals(outer, SSE_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "text/event-stream" },
      signal: ac.signal,
    });
  } catch (err) {
    ac.cleanup();
    const aborted = err instanceof Error && err.name === "AbortError";
    return {
      id: "hub-protocol-events",
      name: EVENTS_NAME,
      status: "fail",
      message: aborted
        ? `No SSE response within ${SSE_TIMEOUT_MS / 1000}s — proxy may be killing the stream`
        : `Cannot open event stream at ${url} (${err instanceof Error ? err.message : "network error"})`,
      fix: aborted
        ? "Check reverse-proxy buffering: nginx needs `proxy_buffering off` for SSE"
        : "Check the Synap container is running",
      durationMs: Date.now() - start,
    };
  }

  if (res.status === 401 || res.status === 403) {
    ac.cleanup();
    return {
      id: "hub-protocol-events",
      name: EVENTS_NAME,
      status: "fail",
      message: `API key rejected on /api/hub/events/stream (${res.status})`,
      fix: "Re-run setup to mint a fresh agent API key",
      durationMs: Date.now() - start,
    };
  }
  if (res.status === 404) {
    ac.cleanup();
    return {
      id: "hub-protocol-events",
      name: EVENTS_NAME,
      status: "fail",
      message: "GET /api/hub/events/stream not available — backend version too old",
      fix: "Update Synap (`eve update synap`)",
      durationMs: Date.now() - start,
    };
  }
  if (!res.ok || !res.body) {
    ac.cleanup();
    return {
      id: "hub-protocol-events",
      name: EVENTS_NAME,
      status: "fail",
      message: `Event stream returned ${res.status} (no body: ${!res.body})`,
      durationMs: Date.now() - start,
    };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let received = false;
  let receivedKind = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
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
  } catch (err) {
    if (!(err instanceof Error && err.name === "AbortError")) {
      try { await reader.cancel(); } catch { /* ignore */ }
      ac.cleanup();
      return {
        id: "hub-protocol-events",
        name: EVENTS_NAME,
        status: "fail",
        message: `Stream read error: ${err instanceof Error ? err.message : "unknown"}`,
        durationMs: Date.now() - start,
      };
    }
  } finally {
    try { await reader.cancel(); } catch { /* ignore */ }
    ac.cleanup();
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
    const ac = combineSignals(outer, ME_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
          ...extraHeaders,
        },
        signal: ac.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        return { ok: false, status: res.status, message: truncate(text) };
      }
      let id: string | null = null;
      try {
        const parsed = JSON.parse(text) as Record<string, unknown>;
        const candidate = parsed.id ?? (parsed.user as Record<string, unknown> | undefined)?.id;
        if (typeof candidate === "string") id = candidate;
      } catch {
        return { ok: false, status: res.status, message: "response was not JSON" };
      }
      return { ok: true, userId: id, status: res.status };
    } catch (err) {
      return {
        ok: false,
        status: 0,
        message: err instanceof Error ? err.message : "network error",
      };
    } finally {
      ac.cleanup();
    }
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

/** Fire-and-forget DELETE — failures are silently ignored. */
export async function deleteEntityBestEffort(
  synapUrl: string,
  apiKey: string,
  entityId: string,
): Promise<void> {
  const ac = combineSignals(undefined, DELETE_TIMEOUT_MS);
  try {
    await fetch(`${synapUrl}/api/hub/entities/${encodeURIComponent(entityId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: ac.signal,
    });
  } catch {
    // Cleanup is best-effort. The throwaway entity is identifiable by its
    // `eve-doctor-idempotency-smoke` title if a user wants to remove it
    // manually. A failed cleanup must NOT demote the probe — that would
    // confuse "your idempotency works" with "you can't delete entities".
  } finally {
    ac.cleanup();
  }
}

/**
 * Combine an outer abort signal with a per-probe timeout. Returns a fresh
 * AbortController whose signal trips when EITHER fires. The `cleanup`
 * function clears the timeout AND removes the outer-signal listener so we
 * don't leak listeners across many probes within the same caller signal.
 */
function combineSignals(outer: AbortSignal | undefined, timeoutMs: number): {
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
