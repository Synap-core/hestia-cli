/**
 * CLI-side IDoctorRunner implementations for `eve doctor` and `eve auth`.
 *
 * # Two runners, one decision
 *
 * The CLI talks to its OWN pod's synap-backend. We pick a transport ONCE
 * at startup based on where we're running:
 *
 *   • **On the pod host** (synap-backend container is here):
 *     `DockerExecRunner` execs into the synap-backend container itself
 *     and runs a tiny inline Node script (`docker exec -i <c> node -e ...`)
 *     that calls `fetch('http://127.0.0.1:4000/...')`. No DNS, no Traefik,
 *     no TLS, no firewall — and crucially no BusyBox/wget either. The
 *     synap-backend image runs Node 20-alpine, which has native fetch, so
 *     we use the same HTTP client the app itself uses.
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
 * # Why we don't use wget anymore
 *
 * The previous version of `DockerExecRunner` shelled into the synap
 * container and ran BusyBox `wget`. That worked, *mostly*, but BusyBox
 * supports a tiny, idiosyncratic subset of wget's flags and silently
 * misbehaves on the wrong arg form (`--header=` is dropped, `--post-data`
 * space-form is dropped, `--method` doesn't exist, etc.). We chased
 * intermittent 404s and "wrong status code" bugs for two days that
 * turned out to be BusyBox quirks, not real backend errors. Replacing
 * `wget` with `node -e 'fetch(...)'` removes the entire failure surface:
 * one inline script, no shell escaping (body via stdin), arbitrary
 * methods supported natively, JSON envelope back. Don't reintroduce wget.
 *
 * # `FallbackRunner` is retained but UNUSED in production
 *
 * Kept for the test suite and as a generic primitive someone might want
 * later. Never wire it into the CLI's happy path.
 */

import { execSync } from "node:child_process";
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
      // `execSync` is imported at module top — using `require()` here was
      // a long-standing bug: this file is bundled as ESM, where `require`
      // is undefined, so every iteration silently threw ReferenceError,
      // the catch swallowed it, and the function ALWAYS returned null on
      // the pod host. That cascaded into `buildPodRunner` always picking
      // `FetchRunner`, which hit the public URL through Traefik (or
      // whatever http/https mismatch existed) and got 404 — the famous
      // "POST /api/hub/setup/agent not available — backend version too
      // old" red herring that wasn't a backend issue at all.
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
  /** URL the in-container Node script will fetch. */
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
 * `/etc/hosts` maps `localhost` to BOTH `::1` and `127.0.0.1`. The Node
 * HTTP listener binds to `0.0.0.0` (IPv4-only), so any IPv6 attempt
 * comes back ECONNREFUSED — which we previously misdiagnosed as
 * "backend is dead." Pin to IPv4.
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
    // Unparseable — fall through with a bare path. fetch will produce
    // a useful error if the input was truly nonsense.
  }

  return {
    container: synap,
    url: `http://127.0.0.1:4000${path}${search}`,
  };
}

// ---------------------------------------------------------------------------
// DockerExecRunner — runs HTTP requests via Node's native fetch inside the
// synap-backend container (image is node:20-alpine, fetch is built in).
// ---------------------------------------------------------------------------

/**
 * Sentinel that separates the JSON status envelope from streaming body
 * bytes when the in-container script is run in streaming mode. Chosen to
 * be highly unlikely to appear in a JSON header line (it starts with a
 * literal newline).
 */
const STREAM_BODY_SENTINEL = "\n---SYNAP-BODY---\n";

/**
 * Build the `docker exec` argv that runs a small inline Node script inside
 * the synap-backend container. The script:
 *
 *   1. Reads the request body from stdin (so callers that POST a payload
 *      avoid shell escaping entirely — the body is a stream of bytes,
 *      never an argv element).
 *   2. Calls `fetch(URL, { method, headers, body, signal })` with an
 *      AbortController wired to a hard timeout.
 *   3. **Non-streaming mode**: writes a single JSON envelope to stdout —
 *      `{ status, body, headers, error? }`. The host parses it and
 *      returns a `DoctorRunnerResponse`.
 *   4. **Streaming mode**: writes the JSON envelope (status + headers)
 *      followed by the body sentinel, then pipes the response body
 *      chunk-by-chunk to stdout. The host reads stdout, splits on the
 *      sentinel, and yields the rest as the SSE stream.
 *
 * The script is passed to `node -e` as a SINGLE argv element, so there
 * is no shell to escape — quotes and newlines inside the script are
 * literal. All call-site values (URL, method, headers, timeout) are
 * embedded via `JSON.stringify`, which produces valid JS literals.
 *
 * `-i` is required so docker exec attaches stdin (the body channel).
 */
type ExecArgs =
  | { container: string; argv: string[]; stdin: string; supported: true }
  | { supported: false; reason: string };

export function buildExecArgs(
  method: "GET" | "POST" | "DELETE",
  url: string,
  headers: Record<string, string>,
  body: string | undefined,
  timeoutMs: number,
  container: string,
  streaming: boolean,
): ExecArgs {
  const script = buildNodeFetchScript(method, url, headers, !!body, timeoutMs, streaming);
  return {
    supported: true,
    container,
    argv: ["exec", "-i", container, "node", "-e", script],
    // Body always goes via stdin — even on GET (empty string closes the pipe).
    stdin: body ?? "",
  };
}

/**
 * Compose the inline Node script. Call-site values are injected via
 * JSON.stringify (safe to embed inside JS source — JSON is a subset of JS).
 *
 * Why all helpers are inlined: docker exec runs this as a one-shot
 * `node -e <script>` invocation with no module resolution, no top-level
 * await, no `require` (we're running plain `node -e`, no bundler). Keep
 * it self-contained.
 */
function buildNodeFetchScript(
  method: "GET" | "POST" | "DELETE",
  url: string,
  headers: Record<string, string>,
  hasBody: boolean,
  timeoutMs: number,
  streaming: boolean,
): string {
  const consts =
    `const URL_=${JSON.stringify(url)};` +
    `const METHOD=${JSON.stringify(method)};` +
    `const HEADERS=${JSON.stringify(headers)};` +
    `const TIMEOUT_MS=${timeoutMs};` +
    `const HAS_BODY=${hasBody ? "true" : "false"};`;

  // Common prefix: collect stdin into `b`, then run main when it closes.
  const prelude =
    `let b='';` +
    `process.stdin.on('data',c=>{b+=c;});` +
    `process.stdin.on('end',async()=>{` +
    `const ac=new AbortController();` +
    `const tid=setTimeout(()=>ac.abort(),TIMEOUT_MS);` +
    `try{` +
    `const r=await fetch(URL_,{method:METHOD,headers:HEADERS,body:HAS_BODY?b:undefined,signal:ac.signal});`;

  if (streaming) {
    // Streaming: write envelope + sentinel, then pipe body chunks raw.
    return (
      consts +
      prelude +
      `const env={status:r.status,headers:Object.fromEntries(r.headers)};` +
      `process.stdout.write(JSON.stringify(env)+${JSON.stringify(STREAM_BODY_SENTINEL)});` +
      `if(r.body){` +
      `const reader=r.body.getReader();` +
      `while(true){` +
      `const{done,value}=await reader.read();` +
      `if(done)break;` +
      `process.stdout.write(Buffer.from(value));` +
      `}` +
      `}` +
      `}catch(e){` +
      `process.stdout.write(JSON.stringify({status:0,headers:{},error:String(e&&e.message||e)})+${JSON.stringify(STREAM_BODY_SENTINEL)});` +
      `}finally{clearTimeout(tid);}` +
      `});`
    );
  }

  // Non-streaming: read full body, write single JSON envelope.
  return (
    consts +
    prelude +
    `const t=await r.text();` +
    `process.stdout.write(JSON.stringify({status:r.status,body:t,headers:Object.fromEntries(r.headers)}));` +
    `}catch(e){` +
    `process.stdout.write(JSON.stringify({status:0,body:'',headers:{},error:String(e&&e.message||e)}));` +
    `}finally{clearTimeout(tid);}` +
    `});`
  );
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
    const timeoutMs = opts.timeoutMs ?? 6_000;
    // Hard wall-clock cap on the docker exec itself — fetch's AbortController
    // is the inner timeout (and produces a clean error envelope). We give
    // docker exec startup a few extra seconds so the inner timeout fires
    // first when the upstream is slow.
    const execTimeoutMs = timeoutMs + 4_000;

    const built = buildExecArgs(method, plan.url, headers, body, timeoutMs, plan.container, false);
    if (!built.supported) {
      return { status: 0, body: "", headers: {}, error: built.reason };
    }

    // Optional verbose mode — `EVE_DEBUG_RUNNER=1 eve <cmd>` prints what
    // we're about to run + the response. Off by default; never touches
    // happy-path performance. Critical when a probe fails and we need to
    // see what the runner actually did.
    const debug = process.env.EVE_DEBUG_RUNNER === "1";
    if (debug) {
      // Print the docker prefix only — the full inline script is long
      // and noisy. The script's behavior is a function of (method, url,
      // headers, body), all of which are visible from the surrounding
      // command flow.
      const prefix = built.argv.slice(0, 5).join(" ");
      process.stderr.write(
        `[debug-runner] exec: docker ${prefix} <node-script> stdin=${built.stdin.length}b method=${method} url=${plan.url}\n`,
      );
    }

    try {
      const res = await execa("docker", built.argv, {
        timeout: execTimeoutMs,
        cancelSignal: opts.signal,
        reject: false,
        input: built.stdin,
        encoding: "utf8",
      });

      const stdout = typeof res.stdout === "string" ? res.stdout : "";
      const stderr = typeof res.stderr === "string" ? res.stderr : "";

      if (debug) {
        process.stderr.write(
          `[debug-runner] exitCode=${res.exitCode} stdout(${stdout.length}b)=${JSON.stringify(stdout.slice(0, 300))} stderr(${stderr.length}b)=${JSON.stringify(stderr.slice(0, 300))}\n`,
        );
      }

      // Happy path: stdout is a JSON envelope produced by our inline
      // script. Anything else means the script never ran (no node? no
      // container? docker exec failed?). Surface stderr in that case —
      // it'll have the docker error message.
      try {
        const parsed = JSON.parse(stdout) as {
          status: number;
          body?: string;
          headers?: Record<string, string>;
          error?: string;
        };
        return {
          status: parsed.status,
          body: parsed.body ?? "",
          headers: parsed.headers ?? {},
          error: parsed.error,
        };
      } catch {
        return {
          status: 0,
          body: "",
          headers: {},
          error:
            stderr.trim().slice(0, 240) ||
            `node-exec produced no JSON envelope (exit ${res.exitCode ?? -1})`,
        };
      }
    } catch (err) {
      // execa throws when the process is killed (timeout, abort signal).
      const e = err as { timedOut?: boolean; isCanceled?: boolean; message?: string };
      const reason = e.timedOut ? "timeout" : e.isCanceled ? "aborted" : (e.message || "exec failed");
      return { status: 0, body: "", headers: {}, error: reason };
    }
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
    const timeoutMs = opts.timeoutMs ?? 35_000;
    const built = buildExecArgs("GET", plan.url, headers, undefined, timeoutMs, plan.container, true);
    if (!built.supported) {
      return {
        ok: false,
        status: 0,
        headers: {},
        close: async () => { /* nothing to close */ },
        error: built.reason,
      };
    }

    let child: ResultPromise<{ encoding: "utf8"; reject: false }>;
    try {
      child = execa("docker", built.argv, {
        encoding: "utf8",
        reject: false,
        // Stream timeout = caller's timeout + grace. The inner script
        // also has its own AbortController on the same budget.
        timeout: timeoutMs + 4_000,
        cancelSignal: opts.signal,
        // Close stdin immediately — streaming is GET-only, no body.
        input: "",
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

    const stdout = child.stdout;
    if (!stdout) {
      try { child.kill("SIGKILL"); } catch { /* ignore */ }
      return {
        ok: false,
        status: 0,
        headers: {},
        close: async () => { await child.catch(() => null); },
        error: "no stdout pipe on docker exec subprocess",
      };
    }
    stdout.setEncoding("utf8");

    // Read stdout until we see the body sentinel. Everything before is
    // the JSON envelope; everything after is the streamed response body.
    //
    // The envelope is wrapped in `state` so TypeScript's control-flow
    // analysis doesn't collapse the post-await type to `never`. With a
    // bare `let envelope = null`, TS sees no synchronous reassignment
    // (the closures' assignments happen via callbacks it can't track)
    // and narrows the variable to `null` forever — making the success
    // branch unreachable from its perspective. Property-on-object
    // assignments aren't narrowed the same way, so this stays correct.
    type Envelope = { status: number; headers: Record<string, string>; error?: string };
    const state: { envelope: Envelope | null; leftover: string; pre: string } = {
      envelope: null,
      leftover: "",
      pre: "",
    };

    const onSentinel = new Promise<void>((resolve) => {
      const handler = (chunk: string) => {
        state.pre += chunk;
        const idx = state.pre.indexOf(STREAM_BODY_SENTINEL);
        if (idx < 0) return;

        const headerJson = state.pre.slice(0, idx);
        try {
          state.envelope = JSON.parse(headerJson);
        } catch {
          state.envelope = {
            status: 0,
            headers: {},
            error: `bad envelope: ${headerJson.slice(0, 200)}`,
          };
        }
        state.leftover = state.pre.slice(idx + STREAM_BODY_SENTINEL.length);
        stdout.removeListener("data", handler);
        resolve();
      };
      stdout.on("data", handler);
    });

    const headerWaitMs = Math.min(8_000, timeoutMs);
    const onTimeout = new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        if (!state.envelope) {
          state.envelope = { status: 0, headers: {}, error: "timed out waiting for envelope" };
        }
        resolve();
      }, headerWaitMs);
      t.unref?.();
    });
    const onExit = child.then((result) => {
      if (!state.envelope) {
        state.envelope = {
          status: 0,
          headers: {},
          error: `subprocess exited before envelope (exit ${result?.exitCode ?? -1})`,
        };
      }
    });

    await Promise.race([onSentinel, onTimeout, onExit]);

    const env = state.envelope;
    if (!env || env.status === 0) {
      try { child.kill("SIGKILL"); } catch { /* ignore */ }
      return {
        ok: false,
        status: 0,
        headers: env?.headers ?? {},
        close: async () => { await child.catch(() => null); },
        error: env?.error ?? "unknown stream failure",
      };
    }

    let closed = false;
    const close = async () => {
      if (closed) return;
      closed = true;
      try { child.kill("SIGTERM"); } catch { /* ignore */ }
      await child.catch(() => null);
    };

    const leftover = state.leftover;
    async function* iterate(): AsyncGenerator<string> {
      if (leftover) yield leftover;
      for await (const chunk of stdout) {
        if (closed) return;
        yield typeof chunk === "string" ? chunk : chunk.toString();
      }
    }

    return {
      ok: true,
      status: env.status,
      headers: env.headers,
      chunks: iterate(),
      close,
    };
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
// Pod transport — always FetchRunner, URL chooses the path
// ---------------------------------------------------------------------------

/**
 * The runner the CLI uses to talk to this pod's API.
 *
 * # One transport, two URLs
 *
 * Earlier versions of this file picked between `DockerExecRunner` and
 * `FetchRunner` based on whether the synap container was running
 * locally. That bought us nothing: the docker-exec path needed its own
 * BusyBox/Node-script gymnastics, and we already had to support
 * FetchRunner for the off-host case. So we collapsed it.
 *
 * Now the on-host vs off-host distinction lives entirely in the URL:
 *
 *   - **On the pod host** — `resolveSynapUrlOnHost(secrets)` returns
 *     `http://127.0.0.1:14000` (the loopback port published by Eve's
 *     `docker-compose.override.yml`). Plain HTTP via FetchRunner; no
 *     DNS, no TLS, no Traefik, no firewall to traverse.
 *
 *   - **Off the pod host** — `resolveSynapUrlOnHost(secrets)` falls
 *     back to the public Traefik URL. Same FetchRunner, same code path.
 *
 * The transport is the same in both cases — that's the whole point.
 * Bytes go through Node's native `fetch`, status codes are real HTTP
 * status codes, the request/response cycle is observable, and there's
 * no `docker exec` cold-start cost on every call.
 *
 * `DockerExecRunner` stays exported — `eve doctor` uses it as a
 * break-glass diagnostic ("can the synap container respond on its own
 * loopback even when host loopback fails?"). Don't wire it back into
 * the happy path. See
 * `synap-team-docs/content/team/devops/eve-cli-transports.mdx` for the
 * full transport-selection design.
 *
 * `onTransportNote` is an optional hook so callers can surface which
 * URL was picked — the doctor uses it to print "using loopback" or
 * "using public URL" alongside its summary. The note is computed by
 * resolving the URL ourselves; callers who don't pass a sink get the
 * note on stderr (one line, never spammy).
 */
export function buildPodRunner(
  onTransportNote?: (note: string) => void,
): IDoctorRunner {
  // Note synthesis is best-effort — we don't want a transport-note
  // failure to abort the actual API call. The note is informational.
  if (onTransportNote || !process.env.EVE_QUIET_TRANSPORT) {
    const note = synthesizeTransportNote();
    if (onTransportNote) {
      onTransportNote(note);
    } else {
      process.stderr.write(`ℹ️  ${note}\n`);
    }
  }
  return new FetchRunner();
}

/**
 * Build a one-line description of which URL the CLI is most likely
 * about to use. Pure heuristic — actual URL selection happens in
 * `resolveSynapUrlOnHost(secrets)`, so this is just for the user-facing
 * note. We check the synap container detection (cheap) without
 * actually doing the loopback probe (also cheap, but async — and the
 * note is fire-and-forget so we don't want to make callers await).
 */
function synthesizeTransportNote(): string {
  const synap = findRunningSynapContainer();
  return synap
    ? `synap container ${synap} detected — CLI will prefer loopback if reachable`
    : "no synap container detected — CLI will use public URL via Traefik";
}
