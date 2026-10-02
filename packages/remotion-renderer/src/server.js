/**
 * The renderer HTTP service.
 *
 * This is the piece that has never existed. The Synap `remotion` capability
 * (`synap-control-plane-api/src/seeds/capability-templates/remotion.capability.json`)
 * declares three verbs against a renderer and notes "response-field shaping is
 * best-effort and confirmed against the live renderer at first run" — i.e. it has
 * never run. The shapes implemented here ARE the contract, chosen to match what
 * those skills already destructure so the capability needs no rewrite.
 *
 *   GET  /health          → { ok, compositions, error }   install readiness
 *   GET  /compositions    → { compositions: [...], count }
 *   POST /render          → { jobId, status }              returns immediately
 *   GET  /status/:jobId   → { jobId, status, progress, outputPath, durationFrames, error }
 *
 * Deliberately dependency-free (`node:http`) so the image stays small and the
 * routing is readable in one file.
 */

import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";

import { JobStore } from "./job-store.js";

const MAX_BODY_BYTES = 1024 * 1024; // 1 MiB — props are JSON, not uploads

/**
 * Constant-time token comparison.
 *
 * Returns false for a length mismatch WITHOUT timingSafeEqual, which is correct:
 * `timingSafeEqual` throws on differing lengths, and a length oracle here leaks
 * nothing meaningful (the token's length is not the secret being protected — the
 * renderer's reachability is).
 */
function tokenMatches(provided, expected) {
  if (!expected) return true; // no token configured → open (in-network only)
  // An EMPTY presented token is treated as ABSENT, not as a wrong token. The pod's
  // `vaultHandler` injects the secret unconditionally, so a keyless install sends
  // an empty `X-Remotion-Token`; refusing that would make a tokenless (in-network)
  // renderer unusable through the only caller that exists.
  if (!provided) return !expected;
  if (typeof provided !== "string" || provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    // The service is called by an agent over the pod's internal network, never a
    // browser; no CORS, no cookies, no caching.
    "cache-control": "no-store",
  });
  res.end(payload);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    /** @type {Buffer[]} */
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8")));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

/**
 * Build the service. Dependencies are injected so the HTTP contract is testable
 * without a real Remotion bundle or a real render.
 *
 * @param {{
 *   projectPath: string,
 *   apiToken?: string,
 *   loadCompositions: () => Promise<{compositions: any[], error: string|null, serveUrl: string|null}>,
 *   renderComposition: (args: any) => Promise<{outputPath: string, durationFrames: number}>,
 *   jobs?: JobStore,
 *   log?: (msg: string) => void,
 * }} deps
 */
export function createRendererServer(deps) {
  const jobs = deps.jobs ?? new JobStore();
  const log = deps.log ?? (() => {});
  // Cached bundle + composition list. Populated on first use, refreshed by
  // `refresh()` when the operator edits their project.
  /** @type {{compositions: any[], error: string|null, serveUrl: string|null} | null} */
  let cache = null;

  async function compositions() {
    if (!cache) cache = await deps.loadCompositions();
    return cache;
  }

  /** Drop the cached bundle so the next call re-reads the project from disk. */
  async function refresh() {
    cache = await deps.loadCompositions();
    return cache;
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://renderer.local");
    const path = url.pathname;

    // Auth applies to everything EXCEPT /health, so an installer can probe
    // readiness without holding the token.
    if (path !== "/health" && !tokenMatches(req.headers["x-remotion-token"], deps.apiToken)) {
      return send(res, 401, { error: "Invalid or missing X-Remotion-Token" });
    }

    try {
      if (req.method === "GET" && path === "/health") {
        const state = await compositions();
        // NOT ok when the project cannot be bundled. A renderer that is up but
        // cannot list a composition is not healthy — reporting otherwise is how
        // an install claims success over a broken setup.
        return send(res, 200, {
          ok: state.error === null,
          compositions: state.compositions.length,
          projectPath: deps.projectPath,
          error: state.error,
        });
      }

      if (req.method === "POST" && path === "/refresh") {
        const state = await refresh();
        return send(res, 200, {
          ok: state.error === null,
          compositions: state.compositions.length,
          error: state.error,
        });
      }

      if (req.method === "GET" && path === "/compositions") {
        const state = await compositions();
        if (state.error) {
          return send(res, 503, {
            error: `Could not load compositions: ${state.error}`,
            compositions: [],
            count: 0,
          });
        }
        return send(res, 200, {
          compositions: state.compositions,
          count: state.compositions.length,
        });
      }

      if (req.method === "POST" && path === "/render") {
        const body = await readJsonBody(req);
        const composition = String(body.composition ?? "").trim();
        const output = String(body.output ?? "").trim();
        const codec = typeof body.codec === "string" ? body.codec : undefined;
        // Forwarded to the renderer. Omitting it made `remotion_render`'s
        // documented `props` argument a no-op — accepted, then discarded.
        const inputProps =
          body.props && typeof body.props === "object" && !Array.isArray(body.props)
            ? body.props
            : {};

        if (!composition) {
          return send(res, 400, { error: "composition is required" });
        }
        if (!output) {
          return send(res, 400, { error: "output is required" });
        }

        const state = await compositions();
        if (state.error) {
          return send(res, 503, { error: `Project could not be bundled: ${state.error}` });
        }
        if (!state.compositions.some((c) => c.name === composition)) {
          // Call `remotion_list_compositions` first — a render with an unknown
          // name is the most common failure, so name the valid ones.
          return send(res, 400, {
            error:
              `Unknown composition "${composition}". ` +
              `Available: ${state.compositions.map((c) => c.name).join(", ") || "(none)"}`,
          });
        }

        const jobId = jobs.create();
        // Respond FIRST, render in the background. The capability declares the
        // render async and tells the caller to poll; blocking here would hold the
        // connection for minutes and blow its 300s timeout.
        send(res, 200, { jobId, status: "queued", composition, output, props: inputProps });

        void (async () => {
          jobs.update(jobId, { status: "rendering", progress: 0 });
          try {
            const result = await deps.renderComposition({
              serveUrl: state.serveUrl,
              composition,
              output,
              codec,
              inputProps,
              onProgress: (pct) => jobs.update(jobId, { progress: pct }),
            });
            jobs.update(jobId, {
              status: "done",
              progress: 100,
              outputPath: result.outputPath,
              durationFrames: result.durationFrames,
            });
            log(`render ${jobId} done → ${result.outputPath}`);
          } catch (err) {
            // A failed render is TERMINAL, never left 'rendering': a caller
            // polling a job that can never advance would hang forever.
            const message = err instanceof Error ? err.message : String(err);
            jobs.update(jobId, { status: "failed", error: message });
            log(`render ${jobId} FAILED: ${message}`);
          }
        })();
        return;
      }

      const statusMatch = /^\/status\/(.+)$/.exec(path);
      if (req.method === "GET" && statusMatch) {
        const jobId = decodeURIComponent(statusMatch[1]);
        return send(res, 200, jobs.get(jobId));
      }

      return send(res, 404, { error: `No route for ${req.method} ${path}` });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return send(res, 500, { error: message });
    }
  });

  return { server, jobs, refresh };
}
