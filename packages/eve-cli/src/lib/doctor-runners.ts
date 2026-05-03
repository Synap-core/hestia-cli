/**
 * CLI-side IDoctorRunner implementations for `eve doctor`.
 *
 * Why this lives in the CLI and not in `@eve/lifecycle`:
 *   - The lifecycle module is framework-agnostic and uses only Node built-ins.
 *     Adding `execa` / `child_process` there would force the dashboard's
 *     bundle to ship a Docker shell-out path it would never call.
 *   - `DockerExecRunner` only makes sense on a host where `docker` is on
 *     PATH and the `eve-legs-traefik` container exists — that's the CLI
 *     context, not the dashboard.
 *
 * Composition:
 *   - `DockerExecRunner` — wraps `docker exec eve-legs-traefik wget`.
 *   - `FallbackRunner` — tries `FetchRunner` first, swaps to
 *     `DockerExecRunner` when fetch hits a transport-level error
 *     (ECONNREFUSED / EHOSTUNREACH / ENOTFOUND). The swap is sticky for
 *     the rest of the run so probe 2/3/4 don't each re-pay the failed
 *     fetch latency.
 *
 * Real-world bug this fixes: on an Eve deployment behind Traefik,
 * synap-backend has NO host port mapping. The CLI's `secrets.synap.apiUrl`
 * is `http://127.0.0.1:4000`, which fails immediately. The doctor reports
 * "Cannot reach Synap backend" and the user thinks the pod is broken.
 * `FallbackRunner` makes the probes still work via container DNS so the
 * user gets real signal (idempotency / SSE / sub-tokens actually run).
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
 * Rewrite a host-side URL to its in-network form for `docker exec wget`.
 *
 * Eve's compose places synap-backend on `eve-network` as
 * `synap-backend-backend-1:4000`. When the configured URL is loopback
 * (`http://127.0.0.1:4000` or `http://localhost:4000`), swap the host. For
 * any other URL (including the public domain) we use it as-is — Traefik
 * inside the container can resolve external hosts through its own DNS,
 * and a public HTTPS URL is the right thing to probe anyway.
 */
export function rewriteUrlForDockerExec(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname === "127.0.0.1" || u.hostname === "localhost") {
      u.hostname = "synap-backend-backend-1";
      // Keep the existing port — synap-backend listens on 4000 inside the
      // container, which is what the configured URL also points at.
      return u.toString();
    }
    return url;
  } catch {
    // Not a parseable URL — let the underlying wget surface the error.
    return url;
  }
}

// ---------------------------------------------------------------------------
// DockerExecRunner — runs HTTP requests via wget inside eve-legs-traefik
// ---------------------------------------------------------------------------

/**
 * Build the `wget` argv used to make the request. We call wget directly
 * (not through `sh -c`) so we don't have to worry about shell quoting of
 * URLs / headers that may contain `&` or `;`.
 *
 * `--server-response` (`-S`) prints the full response status + headers to
 * stderr in `HTTP/1.1 200 OK` / `Header: value` form; `--output-document=-`
 * (`-O -`) writes the body to stdout. We parse stderr for status + headers
 * so we can present a `DoctorRunnerResponse` indistinguishable from the
 * fetch path.
 */
export function buildWgetArgs(
  method: "GET" | "POST" | "DELETE",
  url: string,
  headers: Record<string, string>,
  bodyFile: string | null,
  timeoutSec: number,
): { container: string; argv: string[] } {
  const argv: string[] = [
    "exec",
    "-i",
    "eve-legs-traefik",
    "wget",
    "--quiet",
    "--server-response",
    "--output-document=-",
    `--timeout=${timeoutSec}`,
    "--tries=1",
    `--method=${method}`,
  ];
  for (const [k, v] of Object.entries(headers)) {
    argv.push(`--header=${k}: ${v}`);
  }
  if (bodyFile) {
    argv.push(`--body-file=${bodyFile}`);
  } else if (method === "POST" || method === "DELETE") {
    // Empty body — wget needs `--body-data=` for POST/DELETE without a payload.
    argv.push("--body-data=");
  }
  argv.push(url);
  return { container: "eve-legs-traefik", argv };
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
    const innerUrl = rewriteUrlForDockerExec(url);
    const timeoutSec = Math.max(1, Math.round((opts.timeoutMs ?? 6_000) / 1000));
    // Hard wall-clock cap on the docker exec itself — wget's --timeout is
    // its OWN socket timeout, not the total exec time. We allow a small
    // grace margin (+2s) for docker exec startup so wget's timeout fires
    // first when the upstream is slow.
    const execTimeoutMs = timeoutSec * 1000 + 2_000;

    const { argv } = buildWgetArgs(method, innerUrl, headers, null, timeoutSec);

    try {
      const res = await execa("docker", argv, {
        input: body, // For POST/DELETE: piped via stdin → wget reads --body-file=- equivalently.
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
    if (/bad address|name or service not known|could not resolve/i.test(stderr)) {
      return "DNS lookup failed (container not on eve-network?)";
    }
    if (/connection refused/i.test(stderr)) {
      return "connection refused";
    }
    if (/timed out|timeout/i.test(stderr)) {
      return "timeout";
    }
    return `wget exit ${exitCode}: ${stderr.trim().slice(0, 160) || "no diagnostic"}`;
  }

  async httpStream(
    url: string,
    headers: Record<string, string>,
    opts: { signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<DoctorRunnerStream> {
    const innerUrl = rewriteUrlForDockerExec(url);
    const timeoutSec = Math.max(1, Math.round((opts.timeoutMs ?? 35_000) / 1000));
    const { argv } = buildWgetArgs("GET", innerUrl, headers, null, timeoutSec);

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
