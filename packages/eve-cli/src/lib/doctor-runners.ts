/**
 * CLI-side IDoctorRunner implementations for `eve doctor` and `eve auth`.
 *
 * # Two runners, one decision
 *
 * The CLI talks to its OWN pod's synap-backend. We pick a transport ONCE
 * at startup based on where we're running:
 *
 *   • **On the pod host** (synap-backend container is here):
 *     `DockerExecRunner` execs straight into the container with
 *     `127.0.0.1:4000`. No DNS, no Traefik, no TLS, no firewall — the
 *     fastest, most reliable path possible.
 *
 *   • **Off the pod host** (managing a remote pod from a laptop):
 *     `FetchRunner` against the public Traefik URL. The only option, but
 *     it requires DNS + cert + traefik routing to all be healthy.
 *
 * `buildPodRunner()` makes the decision and returns the right one. There
 * is NO automatic fallback between them: the choice is a property of
 * WHERE we run, not a recoverable state. If the synap container is
 * detected but exec fails mid-call, we surface a clear error instead of
 * silently retrying via the slower public path (which often won't work
 * from inside the pod host either — split-DNS, firewall, cert pending).
 *
 * # Why DockerExecRunner is preferred
 *
 * The previous architecture went through the public URL even when on the
 * pod host. That meant CLI calls did:
 *   DNS → public IP (same machine) → port 443 → Traefik → eve-network → synap
 * just to reach a container running locally. Three failure modes (DNS,
 * cert, traefik routing) for what should be a localhost call. After hours
 * of chasing 401-without-envelope and 404-on-setup/agent symptoms, the
 * real fix was to stop pretending we're a remote client.
 *
 * # `FallbackRunner` is retained but UNUSED in production
 *
 * Kept for the test suite and as a generic primitive someone might want
 * later. Never wire it into the CLI's happy path.
 */

import { execa, type ResultPromise } from "execa";
import {
  FetchRunner,
  isFetchTransportError,
  type DoctorRunnerResponse,
  type DoctorRunnerStream,
  type IDoctorRunner,
} from "@eve/lifecycle";

// ---------------------------------------------------------------------------
// Synap container detection + URL planning
// ---------------------------------------------------------------------------

/**
 * Names the synap-backend container is known to register under, depending
 * on which deploy path created it. We probe in order; first match wins.
 */
const SYNAP_BACKEND_CONTAINER_CANDIDATES: ReadonlyArray<string> = [
  "synap-backend-backend-1",
  "synap-backend",
  "synap-backend-1",
];

let cachedSynapContainer: string | null | undefined;

/**
 * Returns the name of a running synap-backend container, or null if none.
 *
 * Cached for the life of the process because (a) the container's running
 * state is stable for the duration of any single CLI command and (b) every
 * `docker inspect` call is ~50ms — without the cache a single probe-heavy
 * command (`eve doctor`) would burn seconds on redundant checks.
 *
 * Tests can reset the cache via `resetSynapContainerCache()`.
 */
export function findRunningSynapContainer(): string | null {
  if (cachedSynapContainer !== undefined) return cachedSynapContainer;
  for (const name of SYNAP_BACKEND_CONTAINER_CANDIDATES) {
    try {
      const { execSync } = require("node:child_process") as typeof import("node:child_process");
      execSync(`docker inspect --format='{{.State.Running}}' ${name}`, {
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 3000,
      });
      cachedSynapContainer = name;
      return name;
    } catch {
      // try next
    }
  }
  cachedSynapContainer = null;
  return null;
}

/** Test hook — reset the container detection cache. */
export function resetSynapContainerCache(): void {
  cachedSynapContainer = undefined;
}

export interface ExecPlan {
  /** Container we'll exec INTO. */
  container: string;
  /** URL we'll ask wget INSIDE that container to fetch. */
  url: string;
}

/**
 * Plan a `docker exec` request to reach synap-backend.
 *
 * This runner is single-purpose: every URL passed here is meant for THIS
 * pod's API. The hostname in the input is irrelevant — whether the caller
 * resolved `https://pod.example.com/...` or `http://127.0.0.1:4000/...`,
 * we only care about path + query. We always exec INTO the synap-backend
 * container itself and call `127.0.0.1:4000` — bypassing DNS, Traefik,
 * TLS, the host network, and any of a dozen other moving parts that
 * could fail in between.
 *
 * Pinning to `127.0.0.1` (not `localhost`) is deliberate: Alpine's
 * `/etc/hosts` maps `localhost` to BOTH `::1` and `127.0.0.1`, and
 * BusyBox wget often picks `::1` first. The Node HTTP listener binds to
 * `0.0.0.0` (IPv4-only), so any IPv6 attempt comes back ECONNREFUSED —
 * which we previously misdiagnosed as "backend is dead." Pin to IPv4.
 *
 * Returns null if no synap-backend container is running locally; the
 * caller (`DockerExecRunner`) surfaces this as a transport error.
 */
export function planExecRequest(url: string): ExecPlan | null {
  const synap = findRunningSynapContainer();
  if (!synap) return null;

  let path = "/";
  let search = "";
  try {
    const parsed = new URL(url);
    path = parsed.pathname || "/";
    search = parsed.search;
  } catch {
    // Unparseable — fall through with a bare path. wget will still produce
    // a useful error if the input was truly nonsense.
  }

  return {
    container: synap,
    url: `http://127.0.0.1:4000${path}${search}`,
  };
}

// ---------------------------------------------------------------------------
// DockerExecRunner — runs HTTP requests via wget inside eve-legs-traefik
// ---------------------------------------------------------------------------

/**
 * Build the `wget` argv used to make the request. We call wget directly
 * (not through `sh -c`) so we don't have to worry about shell quoting of
 * URLs / headers that may contain `&` or `;`.
 *
 * IMPORTANT: Traefik's image is Alpine-based and ships **BusyBox wget**,
 * not GNU wget. BusyBox supports a tiny subset of GNU's flags. The first
 * version of this runner used `--method=`, `--quiet`, `--header=`,
 * `--timeout=`, `--body-file=`, `--body-data=` — all GNU-only — and every
 * call exited fast with "wget: unrecognized option", which our error
 * classifier then mis-identified as a timeout (BusyBox's usage help text
 * contains the word "timeout" in `-T SEC Network read timeout`). Two
 * silent failures stacked into one inscrutable user message.
 *
 * Flags below are BusyBox-compatible AND also valid in GNU wget:
 *   -q             quiet (no progress)
 *   -S             show server response on stderr (HTTP/1.1 lines + headers)
 *   -O -           write body to stdout
 *   -T <sec>       network read timeout
 *   --header HDR   request header (separate args, no `=`)
 *   --post-data S  POST body (BusyBox doesn't understand --body-data=)
 *
 * BusyBox wget does NOT support DELETE / PUT / PATCH / arbitrary methods.
 * For DELETE we return a sentinel that the runner treats as a no-op,
 * which matches our existing best-effort cleanup semantics.
 */
type WgetArgs =
  | { container: string; argv: string[]; supported: true }
  | { supported: false; reason: string };

export function buildWgetArgs(
  method: "GET" | "POST" | "DELETE",
  url: string,
  headers: Record<string, string>,
  body: string | undefined,
  timeoutSec: number,
  container: string,
): WgetArgs {
  if (method === "DELETE") {
    // BusyBox wget can't issue arbitrary HTTP methods. Cleanup callers
    // already use .catch(() => undefined) so a no-op response is fine.
    return {
      supported: false,
      reason: "BusyBox wget cannot issue DELETE — cleanup skipped",
    };
  }

  const argv: string[] = [
    "exec",
    container,
    "wget",
    "-q",
    "-S",
    "-O",
    "-",
    "-T",
    String(timeoutSec),
  ];
  for (const [k, v] of Object.entries(headers)) {
    // Separate args (no `=`) — BusyBox accepts only this form, GNU
    // accepts both, so this is the safe intersection.
    argv.push("--header", `${k}: ${v}`);
  }
  if (method === "POST") {
    argv.push("--post-data", body ?? "");
  }
  argv.push(url);
  return { container, argv, supported: true };
}

/** Parse the `HTTP/1.1 NNN ...` status line out of wget's stderr. */
function parseStatusFromStderr(stderr: string): { status: number; headers: Record<string, string> } {
  const out: Record<string, string> = {};
  let status = 0;

  // wget prints `  HTTP/1.1 200 OK` (with leading spaces) followed by
  // `  Header: value` lines, optionally repeated for redirects (we
  // disabled redirects via --max-redirect=0 implicitly — wget follows
  // by default; for our endpoints this isn't an issue).
  const lines = stderr.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    const m = /^HTTP\/[\d.]+\s+(\d{3})\b/.exec(line);
    if (m) {
      // Last status line wins (in case of redirects).
      status = parseInt(m[1], 10);
      // Reset headers — only keep the headers from the FINAL response.
      for (const k of Object.keys(out)) delete out[k];
      continue;
    }
    const h = /^([A-Za-z][A-Za-z0-9-]*)\s*:\s*(.*)$/.exec(line);
    if (h) {
      out[h[1].toLowerCase()] = h[2];
    }
  }
  return { status, headers: out };
}

export class DockerExecRunner implements IDoctorRunner {
  readonly name = "docker-exec";

  async httpGet(
    url: string,
    headers: Record<string, string>,
    opts: { signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<DoctorRunnerResponse> {
    return this.invoke("GET", url, headers, undefined, opts);
  }

  async httpPost(
    url: string,
    headers: Record<string, string>,
    body: string,
    opts: { signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<DoctorRunnerResponse> {
    return this.invoke("POST", url, headers, body, opts);
  }

  async httpDelete(
    url: string,
    headers: Record<string, string>,
    opts: { signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<DoctorRunnerResponse> {
    return this.invoke("DELETE", url, headers, undefined, opts);
  }

  private async invoke(
    method: "GET" | "POST" | "DELETE",
    url: string,
    headers: Record<string, string>,
    body: string | undefined,
    opts: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<DoctorRunnerResponse> {
    const plan = planExecRequest(url);
    if (!plan) {
      return {
        status: 0,
        body: "",
        headers: {},
        error: "no synap-backend container available for docker-exec — run on the pod host or use FetchRunner",
      };
    }
    const timeoutSec = Math.max(1, Math.round((opts.timeoutMs ?? 6_000) / 1000));
    // Hard wall-clock cap on the docker exec itself — wget's -T is its
    // OWN socket timeout, not the total exec time. We allow a small
    // grace margin (+2s) for docker exec startup so wget's timeout fires
    // first when the upstream is slow.
    const execTimeoutMs = timeoutSec * 1000 + 2_000;

    const built = buildWgetArgs(method, plan.url, headers, body, timeoutSec, plan.container);
    if (!built.supported) {
      // DELETE on BusyBox — return a soft failure. Callers use this for
      // best-effort cleanup and ignore the result via .catch(() => undefined).
      return { status: 0, body: "", headers: {}, error: built.reason };
    }
    const { argv } = built;

    try {
      const res = await execa("docker", argv, {
        timeout: execTimeoutMs,
        cancelSignal: opts.signal,
        reject: false,
        stripFinalNewline: false,
        encoding: "utf8",
      });

      const stdout = typeof res.stdout === "string" ? res.stdout : "";
      const stderr = typeof res.stderr === "string" ? res.stderr : "";
      const parsed = parseStatusFromStderr(stderr);

      // wget exit codes:
      //   0 = OK
      //   1 = generic
      //   4 = network failure (DNS, refused, unreachable)
      //   5 = SSL verification
      //   8 = server response (4xx/5xx) — we still get the body in stdout
      //
      // We map exit==0 OR exit==8 (got a response) to "we have a status
      // code"; anything else is a transport failure (status 0).
      if (parsed.status > 0) {
        return { status: parsed.status, body: stdout, headers: parsed.headers };
      }

      // No HTTP status parsed → genuine transport error (DNS, refused).
      return {
        status: 0,
        body: stdout,
        headers: {},
        error: this.summarizeTransportError(stderr, res.exitCode ?? -1),
      };
    } catch (err) {
      // execa throws when the process is killed (timeout, abort signal).
      const e = err as { timedOut?: boolean; isCanceled?: boolean; message?: string };
      const reason = e.timedOut ? "timeout" : e.isCanceled ? "aborted" : (e.message || "exec failed");
      return { status: 0, body: "", headers: {}, error: reason };
    }
  }

  private summarizeTransportError(stderr: string, exitCode: number): string {
    // Order matters — most specific first. BusyBox wget prints its
    // entire usage block to stderr when a flag is unrecognized, and
    // that block contains the literal word "timeout" (e.g. "Network
    // read timeout is SEC seconds"). The previous version of this
    // function matched /timeout/ and reported a real timeout — the
    // exact false positive that masked the BusyBox compatibility bug
    // in the first place. Detect the usage block first and surface
    // the actual error reason.
    if (/Usage:\s*wget/i.test(stderr) && /unrecognized option/i.test(stderr)) {
      const m = /unrecognized option:\s*([^\n]+)/i.exec(stderr);
      const flag = m ? m[1].trim() : "(unknown)";
      return `wget rejected flag '${flag}' — likely BusyBox vs GNU wget mismatch`;
    }
    if (/bad address|name or service not known|could not resolve/i.test(stderr)) {
      return "DNS lookup failed (container not on eve-network?)";
    }
    if (/connection refused/i.test(stderr)) {
      return "connection refused";
    }
    // Match runtime timeout phrases only — NOT the literal word
    // "timeout" which appears in BusyBox's usage help text.
    if (/timed out|operation timed out|read error.*timed out/i.test(stderr)) {
      return "timeout";
    }
    return `wget exit ${exitCode}: ${stderr.trim().slice(0, 160) || "no diagnostic"}`;
  }

  async httpStream(
    url: string,
    headers: Record<string, string>,
    opts: { signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<DoctorRunnerStream> {
    const plan = planExecRequest(url);
    if (!plan) {
      return {
        ok: false,
        status: 0,
        headers: {},
        close: async () => { /* nothing to close */ },
        error: "no synap-backend container available for docker-exec",
      };
    }
    const timeoutSec = Math.max(1, Math.round((opts.timeoutMs ?? 35_000) / 1000));
    const built = buildWgetArgs("GET", plan.url, headers, undefined, timeoutSec, plan.container);
    if (!built.supported) {
      // GET should always be supported by buildWgetArgs; this is an
      // exhaustiveness guard so the type narrows correctly below.
      return {
        ok: false,
        status: 0,
        headers: {},
        close: async () => { /* nothing to close */ },
        error: built.reason,
        async *[Symbol.asyncIterator]() { /* never yields */ },
      } as DoctorRunnerStream;
    }
    const { argv } = built;

    // We need stdout streaming. execa returns a stream-able subprocess
    // when called without `await`; we attach our own data handler.
    let child: ResultPromise<{ encoding: "utf8"; reject: false }>;
    try {
      child = execa("docker", argv, {
        encoding: "utf8",
        reject: false,
        timeout: timeoutSec * 1000 + 2_000,
        cancelSignal: opts.signal,
      });
    } catch (err) {
      return {
        ok: false,
        status: 0,
        headers: {},
        close: async () => { /* nothing */ },
        error: err instanceof Error ? err.message : "exec failed",
      };
    }

    // wget --server-response writes status/headers to stderr BEFORE the
    // first body byte. We collect stderr until we see the blank line
    // marking end-of-headers, then start emitting body chunks from
    // stdout. SSE bodies stream line-by-line — wget itself buffers
    // some, but not pathologically.
    let stderrBuf = "";
    let headersResolved: ((value: { status: number; headers: Record<string, string> }) => void) | null = null;
    const headersPromise = new Promise<{ status: number; headers: Record<string, string> }>((resolve) => {
      headersResolved = resolve;
    });

    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderrBuf += chunk;
      // End of headers = a blank line after the last header. wget puts
      // the blank line right after the final header it parsed.
      if (headersResolved && /\n\s*\n/.test(stderrBuf)) {
        const parsed = parseStatusFromStderr(stderrBuf);
        if (parsed.status > 0) {
          headersResolved(parsed);
          headersResolved = null;
        }
      }
    });

    // Wait up to a small budget for headers — if wget never emits them,
    // assume the request itself failed (DNS, refused) and surface the
    // transport error.
    const headerTimeout = new Promise<{ status: number; headers: Record<string, string> }>((resolve) => {
      const t = setTimeout(() => resolve({ status: 0, headers: {} }), Math.min(8_000, timeoutSec * 1000));
      // Don't keep the Node event loop alive on this timer.
      t.unref?.();
    });
    // Also resolve on early exit — child died before headers arrived.
    const exitGuard = child.then(() => ({ status: 0, headers: {} }));

    const headerInfo = await Promise.race([headersPromise, headerTimeout, exitGuard]);

    if (headerInfo.status === 0) {
      // No headers seen → kill the child and surface as transport error.
      try { child.kill("SIGKILL"); } catch { /* ignore */ }
      const result = await child.catch(() => null);
      const stderr = typeof result?.stderr === "string" ? result.stderr : stderrBuf;
      return {
        ok: false,
        status: 0,
        headers: {},
        close: async () => { /* already dead */ },
        error: this.summarizeTransportErrorPublic(stderr),
      };
    }

    // Successful headers → stream stdout. We yield decoded UTF-8 chunks.
    // Caller breaks out of the loop and invokes `close()` to terminate
    // the docker exec (which terminates wget which closes the SSE
    // connection).
    let closed = false;
    const close = async () => {
      if (closed) return;
      closed = true;
      try { child.kill("SIGTERM"); } catch { /* ignore */ }
      // Drain so the subprocess actually exits.
      await child.catch(() => null);
    };

    async function* iterate(): AsyncGenerator<string> {
      const stdout = child.stdout;
      if (!stdout) return;
      stdout.setEncoding("utf8");
      // Use the readable iterator — Node streams are async-iterable
      // out of the box, yielding string chunks (encoding set above).
      for await (const chunk of stdout) {
        if (closed) return;
        yield typeof chunk === "string" ? chunk : chunk.toString();
      }
    }

    return {
      ok: true,
      status: headerInfo.status,
      headers: headerInfo.headers,
      chunks: iterate(),
      close,
    };
  }

  // Public wrapper so the stream path can reuse the helper. (Renamed
  // because TS doesn't like a private and a public method sharing a
  // name on the same class.)
  private summarizeTransportErrorPublic(stderr: string): string {
    return this.summarizeTransportError(stderr, -1);
  }
}

// ---------------------------------------------------------------------------
// FallbackRunner — fetch first, swap to docker-exec on transport failure
// ---------------------------------------------------------------------------

/**
 * Wraps a primary runner (FetchRunner) and falls back to a secondary
 * runner (DockerExecRunner) when the primary hits a transport error.
 * The swap is sticky — once we've decided fetch can't reach the host,
 * we route every subsequent call through docker exec, no point retrying.
 *
 * The optional `onSwap` callback fires exactly once. The CLI wires this
 * to a stderr log line so the user sees why the probes are still working
 * despite an unreachable URL.
 */
export class FallbackRunner implements IDoctorRunner {
  readonly name = "fallback";

  private active: IDoctorRunner;
  private swapped = false;

  constructor(
    private readonly primary: IDoctorRunner,
    private readonly secondary: IDoctorRunner,
    private readonly onSwap?: (note: string) => void,
  ) {
    this.active = primary;
  }

  /** Force a swap — useful for tests and for callers that want to start in fallback mode. */
  forceSwap(reason: string): void {
    if (this.swapped) return;
    this.swapped = true;
    this.active = this.secondary;
    this.onSwap?.(`note: routing probes through ${this.secondary.name} (${reason})`);
  }

  private async withFallback<T extends DoctorRunnerResponse>(
    invoke: (runner: IDoctorRunner) => Promise<T>,
  ): Promise<T> {
    if (this.swapped) return invoke(this.active);

    const res = await invoke(this.active);
    if (res.status === 0 && this.shouldSwap(res.error)) {
      this.forceSwap("host loopback unreachable");
      return invoke(this.active);
    }
    return res;
  }

  private shouldSwap(error: string | undefined): boolean {
    if (!error) return false;
    // Match the same set FetchRunner reports as transport errors. The
    // primary FetchRunner already filters via `isFetchTransportError`
    // when it shapes the error; we rely on the message containing one
    // of the codes, OR being one of fetch's well-known fallbacks.
    if (/ECONNREFUSED|EHOSTUNREACH|ENOTFOUND|EAI_AGAIN/i.test(error)) return true;
    // Native fetch on Node 20+ surfaces transport errors as the literal
    // string "fetch failed" with the cause buried in a `cause` property
    // we can't see at this layer. Treat it as a swap signal — the
    // worst case is one wasted docker exec for something that was
    // genuinely a server-side error, but the host-unreachable case
    // is way more common in the deployment we're hardening against.
    if (/fetch failed/i.test(error)) return true;
    // On hosts with no port mapping, fetch can hang until timeout
    // instead of getting a quick RST (e.g. when the host firewall
    // silently drops the SYN, or when Node tries IPv6 first). The
    // user-visible symptom is "(timeout)" not "ECONNREFUSED". Treat
    // any timeout / aborted-by-deadline as a transport failure too —
    // we'd rather waste one docker exec than report the probe as dead.
    if (/timeout|timed out|TimeoutError|AbortError|aborted|signal aborted|ETIMEDOUT/i.test(error)) return true;
    return false;
  }

  async httpGet(
    url: string,
    headers: Record<string, string>,
    opts?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<DoctorRunnerResponse> {
    return this.withFallback(r => r.httpGet(url, headers, opts));
  }

  async httpPost(
    url: string,
    headers: Record<string, string>,
    body: string,
    opts?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<DoctorRunnerResponse> {
    return this.withFallback(r => r.httpPost(url, headers, body, opts));
  }

  async httpDelete(
    url: string,
    headers: Record<string, string>,
    opts?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<DoctorRunnerResponse> {
    return this.withFallback(r => r.httpDelete(url, headers, opts));
  }

  async httpStream(
    url: string,
    headers: Record<string, string>,
    opts?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<DoctorRunnerStream> {
    if (this.swapped) return this.active.httpStream(url, headers, opts);

    const res = await this.active.httpStream(url, headers, opts);
    if (!res.ok && res.status === 0 && this.shouldSwap(res.error)) {
      await res.close();
      this.forceSwap("host loopback unreachable");
      return this.active.httpStream(url, headers, opts);
    }
    return res;
  }
}

// Re-export the parts the CLI's doctor command consumes.
export { FetchRunner, isFetchTransportError };

// ---------------------------------------------------------------------------
// Single decision: on-host = docker-exec, off-host = fetch
// ---------------------------------------------------------------------------

/**
 * Pick the right transport for talking to THIS pod's API.
 *
 * - **On the pod host** (synap-backend container is running locally):
 *   `DockerExecRunner`. Direct exec with `127.0.0.1:4000`. No DNS, no
 *   Traefik, no TLS — the fastest, most reliable path. Works regardless
 *   of public domain config, cert state, or firewall.
 *
 * - **Off the pod host** (managing remotely): `FetchRunner` against the
 *   public URL. The only option, requires DNS + cert + traefik to be
 *   healthy. The caller is responsible for resolving the public URL via
 *   `resolveSynapUrl(secrets)`.
 *
 * No automatic fallback between the two. The choice is a property of
 * WHERE we run, not a transient state to recover from. If we're on the
 * pod host and exec fails (rare), we surface a clear error instead of
 * silently retrying via the public URL — which on a pod host often
 * doesn't work either (split-DNS, firewall, cert pending).
 *
 * `onTransportNote` is an optional one-time hook so callers can surface
 * which path was chosen — the doctor uses it to print a one-liner so
 * users know whether they're on the local fast path or the remote path.
 */
export function buildPodRunner(
  onTransportNote?: (note: string) => void,
): IDoctorRunner {
  const synap = findRunningSynapContainer();
  if (synap) {
    onTransportNote?.(`using docker-exec into ${synap} (on-host CLI)`);
    return new DockerExecRunner();
  }
  onTransportNote?.("using fetch against public pod URL (off-host CLI)");
  return new FetchRunner();
}
