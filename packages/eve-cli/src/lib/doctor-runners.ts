/**
 * CLI-side IDoctorRunner implementations for `eve doctor` and `eve auth`.
 *
 * Why this lives in the CLI and not in `@eve/lifecycle`:
 *   - The lifecycle module is framework-agnostic and uses only Node built-ins.
 *     Adding `execa` / `child_process` there would force the dashboard's
 *     bundle to ship a Docker shell-out path it would never call.
 *   - `DockerExecRunner` only makes sense on a host where `docker` is on
 *     PATH and a synap-backend container exists — CLI context only.
 *
 * Composition:
 *   - `DockerExecRunner` — wraps `docker exec` into either synap-backend
 *     directly (when reachable) or eve-legs-traefik. See `planExecRequest`
 *     for the routing logic.
 *   - `FallbackRunner` — tries `FetchRunner` first, swaps to
 *     `DockerExecRunner` on transport-level errors. Sticky for the run.
 *   - `buildDoctorRunner()` — single canonical builder used by every
 *     CLI command. Don't instantiate `FallbackRunner` directly elsewhere.
 *
 * Defensive net, not the happy path. With `resolveSynapUrl` (in `@eve/dna`)
 * returning the public Traefik URL whenever a domain is configured, native
 * fetch reaches the pod fine on every standard install — the swap to
 * docker-exec only fires for true bootstrap edge cases (cert pending,
 * DNS not propagated, no domain).
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
// URL → in-network rewrite
// ---------------------------------------------------------------------------

/**
 * Plan a `docker exec wget` invocation: pick the right container to
 * exec INTO, plus the URL form that container should fetch.
 *
 * Why this matters: Eve's `eve-legs-traefik` lives on `eve-network`. The
 * synap-backend pod sometimes lives on its own compose network (e.g.
 * `synap-backend_default`) and is NOT reachable from traefik by hostname.
 * Routing every probe through traefik then fails DNS for `synap-backend-*`.
 *
 * The robust play is: for synap-backend probes (URL points at loopback
 * or at the synap container hostname), exec STRAIGHT INTO synap-backend
 * itself and call `localhost:4000`. No cross-network DNS, no traefik in
 * the path. For public/external URLs, traefik is fine — it has internet
 * egress. For other internal hostnames (`intelligence-hub`, etc.) we
 * still try traefik first.
 *
 * Returns `null` if nothing usable is on this host (no docker, neither
 * candidate container running). Callers should surface a clear error.
 */
const SYNAP_BACKEND_CONTAINER_CANDIDATES: ReadonlyArray<string> = [
  "synap-backend-backend-1",
  "synap-backend",
  "synap-backend-1",
];

const TRAEFIK_CONTAINER = "eve-legs-traefik";

let cachedSynapContainer: string | null | undefined;

function findRunningSynapContainer(): string | null {
  if (cachedSynapContainer !== undefined) return cachedSynapContainer;
  for (const name of SYNAP_BACKEND_CONTAINER_CANDIDATES) {
    try {
      // `docker inspect` exits non-zero if the container doesn't exist;
      // `--format` is noise-free and won't paginate. Ignore stdout/stderr
      // — we only care about the exit code.
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

export interface ExecPlan {
  container: string;
  url: string;
}

export function planExecRequest(url: string): ExecPlan {
  let parsed: URL | null = null;
  try {
    parsed = new URL(url);
  } catch {
    // Unparseable — let wget surface the error from inside traefik.
    return { container: TRAEFIK_CONTAINER, url };
  }

  const host = parsed.hostname;
  const targetsSynap =
    host === "127.0.0.1" ||
    host === "localhost" ||
    host === "synap-backend-backend-1" ||
    host === "synap-backend" ||
    host === "synap-backend-1";

  if (targetsSynap) {
    // First choice: exec into synap-backend itself with 127.0.0.1. This
    // works regardless of network topology. We use 127.0.0.1 (not
    // `localhost`) because Alpine's /etc/hosts maps `localhost` to BOTH
    // ::1 and 127.0.0.1, and BusyBox wget often picks ::1 first. The
    // Node HTTP listener binds to 0.0.0.0 (IPv4 only) so any IPv6
    // attempt comes back ECONNREFUSED — the original "backend is dead"
    // false positive that took an hour to diagnose. Pin to IPv4.
    const synap = findRunningSynapContainer();
    if (synap) {
      const u = new URL(url);
      u.hostname = "127.0.0.1";
      return { container: synap, url: u.toString() };
    }
    // No live synap container — let traefik try in case it's on a
    // network we share. Rewrite to the canonical hostname.
    const u = new URL(url);
    u.hostname = "synap-backend-backend-1";
    return { container: TRAEFIK_CONTAINER, url: u.toString() };
  }

  // Anything else (public domain, eve-* hostname) → traefik.
  return { container: TRAEFIK_CONTAINER, url };
}

/**
 * Back-compat wrapper retained for existing callers and tests. Returns
 * just the rewritten URL — newer callers should use `planExecRequest`.
 */
export function rewriteUrlForDockerExec(url: string): string {
  return planExecRequest(url).url;
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
  container: string = TRAEFIK_CONTAINER,
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
// Shared builder — single way to construct the CLI's defensive runner
// ---------------------------------------------------------------------------

/**
 * Build the canonical CLI runner: native fetch first, docker-exec fallback
 * on transport errors. Used by `eve doctor`, `eve auth provision/renew/status`,
 * and any future commands that need to talk to the pod.
 *
 * With the new resolveSynapUrl architecture this should rarely fall back —
 * the resolver returns the public Traefik URL whenever a domain is set, and
 * fetch reaches that fine. Fallback exists for the bootstrap moment (cert
 * pending, DNS not yet propagated) and pure local installs without a domain.
 *
 * `onSwapNote` is optional; pass a recorder if the caller wants to surface
 * the swap reason in its UI (the doctor does), or omit for silent fallback.
 */
export function buildDoctorRunner(
  onSwapNote?: (note: string) => void,
): FallbackRunner {
  return new FallbackRunner(
    new FetchRunner(),
    new DockerExecRunner(),
    onSwapNote,
  );
}
