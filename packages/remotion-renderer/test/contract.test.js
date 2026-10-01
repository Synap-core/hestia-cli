/**
 * The HTTP contract the Synap `remotion` capability calls.
 *
 * These drive the REAL server over a real socket with a real injected
 * loadCompositions/renderComposition seam — not hand-built response objects. The
 * seam is what makes it testable without a Remotion bundle; bypassing the server
 * (asserting on `jobs.get()` directly) would leave the routing, auth, status
 * codes, and response SHAPES untested, which is the entire surface the capability
 * depends on.
 *
 * WHAT IT PROVES
 *   1. `/health`, `/compositions`, `/render`, `/status/:id` answer the exact
 *      shapes the capability's skills destructure.
 *   2. A render returns a job id IMMEDIATELY and reaches `done` — the contract is
 *      async, so a service that blocked would break the 300s timeout.
 *   3. A failed render is TERMINAL (`failed`), never stuck `rendering`.
 *   4. An unbundleable project makes `/health` report ok:false rather than
 *      healthy-with-zero-compositions.
 *   5. Auth: a wrong token is 401; `/health` is exempt so an installer can probe.
 *   6. An unknown composition is refused WITH the valid names, since the
 *      capability tells the agent to list first.
 *
 * NOT COVERED: Remotion itself — bundling, codec selection, actual MP4 bytes. That
 * needs a real project and a headless browser; these tests assert the contract
 * the pod depends on, and the pod run is where the real render is proven.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";

import { createRendererServer } from "../src/server.js";
import { JobStore } from "../src/job-store.js";

const COMPOSITIONS = [
  { name: "ViewTransition", durationFrames: 360, fps: 30, width: 1920, height: 1080 },
  { name: "ShortClip", durationFrames: 90, fps: 24, width: 1080, height: 1080 },
];

/** Boot the real server on an ephemeral port with an injected render seam. */
async function withServer(overrides = {}, fn) {
  let renderImpl =
    overrides.renderComposition ??
    (async ({ output }) => ({ outputPath: output, durationFrames: 360 }));

  const { server } = createRendererServer({
    projectPath: "/opt/remotion",
    apiToken: undefined,
    loadCompositions:
      overrides.loadCompositions ??
      (async () => ({ compositions: COMPOSITIONS, error: null, serveUrl: "http://bundle" })),
    renderComposition: (...args) => renderImpl(...args),
    jobs: new JobStore(),
    log: () => {},
    ...("apiToken" in overrides ? { apiToken: overrides.apiToken } : {}),
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;

  const call = async (method, path, body, headers = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { "content-type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };

  try {
    await fn(call, { base, setRender: (fn) => { renderImpl = fn; } });
  } finally {
    server.close();
    await once(server, "close");
  }
}

describe("renderer HTTP contract", () => {
  test("GET /health reports the composition count", async () => {
    await withServer({}, async (call) => {
      const { status, body } = await call("GET", "/health");
      assert.equal(status, 200);
      assert.equal(body.ok, true);
      assert.equal(body.compositions, 2);
      assert.equal(body.error, null);
    });
  });

  test("GET /compositions returns the shape the capability destructures", async () => {
    await withServer({}, async (call) => {
      const { status, body } = await call("GET", "/compositions");
      assert.equal(status, 200);
      assert.equal(body.count, 2);
      // Every field `remotion_list_compositions` maps must be present. The
      // capability reads `durationFrames ?? durationInFrames`; the renderer
      // normalizes to `durationFrames`, so that fallback is dead here by design.
      for (const key of ["name", "durationFrames", "fps", "width", "height"]) {
        assert.ok(key in body.compositions[0], `missing ${key}`);
      }
      assert.equal(body.compositions[0].name, "ViewTransition");
      assert.equal(body.compositions[0].durationFrames, 360);
    });
  });

  test("an unbundleable project reports ok:false, not healthy-with-zero", async () => {
    await withServer(
      {
        loadCompositions: async () => ({
          compositions: [],
          error: "Module not found: ./Root",
          serveUrl: null,
        }),
      },
      async (call) => {
        const { body } = await call("GET", "/health");
        // An install must not report success against a renderer that cannot
        // list a single composition.
        assert.equal(body.ok, false);
        assert.match(body.error, /Module not found/);
      },
    );
  });

  test("POST /render returns a job id immediately and the job reaches done", async () => {
    await withServer({}, async (call) => {
      const started = await call("POST", "/render", {
        composition: "ViewTransition",
        output: "/opt/remotion/out/clip.mp4",
      });

      assert.equal(started.status, 200);
      assert.equal(started.body.status, "queued");
      assert.ok(started.body.jobId, "no jobId returned");

      // The response must arrive BEFORE the render finishes — that is the whole
      // point of the async contract. A blocking service would hang here.
      let job = null;
      for (let i = 0; i < 50; i++) {
        job = (await call("GET", `/status/${started.body.jobId}`)).body;
        if (job.status === "done" || job.status === "failed") break;
        await new Promise((r) => setTimeout(r, 10));
      }

      assert.equal(job.status, "done");
      assert.equal(job.progress, 100);
      assert.equal(job.outputPath, "/opt/remotion/out/clip.mp4");
      assert.equal(job.durationFrames, 360);
      assert.equal(job.error, null);
    });
  });

  test("a failed render is terminal, never stuck rendering", async () => {
    await withServer(
      {
        renderComposition: async () => {
          throw new Error("chrome not found");
        },
      },
      async (call) => {
        const { body } = await call("POST", "/render", {
          composition: "ViewTransition",
          output: "/opt/remotion/out/clip.mp4",
        });

        let job = null;
        for (let i = 0; i < 50; i++) {
          job = (await call("GET", `/status/${body.jobId}`)).body;
          if (job.status === "done" || job.status === "failed") break;
          await new Promise((r) => setTimeout(r, 10));
        }

        // A caller polling a job that can never advance would hang forever.
        assert.equal(job.status, "failed");
        assert.match(job.error, /chrome not found/);
      },
    );
  });

  test("render reports progress while running", async () => {
    await withServer(
      {
        renderComposition: async ({ onProgress }) => {
          onProgress?.(50);
          await new Promise((r) => setTimeout(r, 30));
          onProgress?.(100);
          return { outputPath: "/out/x.mp4", durationFrames: 10 };
        },
      },
      async (call) => {
        const { body } = await call("POST", "/render", { composition: "ViewTransition", output: "/out/x.mp4" });

        let sawPartial = false;
        for (let i = 0; i < 50; i++) {
          const job = (await call("GET", `/status/${body.jobId}`)).body;
          if (job.status === "rendering" && job.progress > 0 && job.progress < 100) sawPartial = true;
          if (job.status === "done" || job.status === "failed") break;
          await new Promise((r) => setTimeout(r, 5));
        }
        // A long render must look like it is moving, not stalled.
        assert.ok(sawPartial, "never observed an intermediate progress value");
      },
    );
  });

  test("an unknown composition is refused and names the valid ones", async () => {
    await withServer({}, async (call) => {
      const { status, body } = await call("POST", "/render", {
        composition: "NoSuchComp",
        output: "/out/x.mp4",
      });
      assert.equal(status, 400);
      // The capability tells the agent to list first; naming them here makes the
      // failure self-correcting.
      assert.match(body.error, /ViewTransition/);
      assert.match(body.error, /ShortClip/);
    });
  });

  test("missing arguments are rejected with a 400, not a thrown 500", async () => {
    await withServer({}, async (call) => {
      assert.equal((await call("POST", "/render", { output: "/out/x.mp4" })).status, 400);
      assert.equal((await call("POST", "/render", { composition: "ViewTransition" })).status, 400);
    });
  });

  test("an unknown job id reports failed with an explanation", async () => {
    await withServer({}, async (call) => {
      const { status, body } = await call("GET", "/status/does-not-exist");
      assert.equal(status, 200);
      // The store dies with the container; a caller must be told that plainly
      // rather than seeing a 404 it has to interpret.
      assert.equal(body.status, "failed");
      assert.match(body.error, /Unknown or expired/);
    });
  });

  test("auth rejects a wrong token but exempts /health", async () => {
    await withServer({ apiToken: "s3cret" }, async (call) => {
      // /health must stay open so an installer can probe without the token.
      assert.equal((await call("GET", "/health")).status, 200);

      assert.equal((await call("GET", "/compositions")).status, 401);
      assert.equal(
        (await call("GET", "/compositions", undefined, { "x-remotion-token": "wrong" })).status,
        401,
      );
      assert.equal(
        (await call("GET", "/compositions", undefined, { "x-remotion-token": "s3cret" })).status,
        200,
      );
    });
  });

  test("an unknown route is a 404 naming the method and path", async () => {
    await withServer({}, async (call) => {
      const { status, body } = await call("GET", "/nope");
      assert.equal(status, 404);
      assert.match(body.error, /GET \/nope/);
    });
  });
});

describe("job store", () => {
  test("clamps progress to 0..100", () => {
    const jobs = new JobStore();
    const id = jobs.create();
    jobs.update(id, { progress: 105 });
    assert.equal(jobs.get(id).progress, 100);
    jobs.update(id, { progress: -20 });
    assert.equal(jobs.get(id).progress, 0);
  });

  test("evicts finished jobs before rendering ones", () => {
    const jobs = new JobStore({ maxJobs: 3 });
    const done = jobs.create();
    jobs.update(done, { status: "done" });
    const running = jobs.create();
    jobs.update(running, { status: "rendering" });

    // Force over the cap twice; the in-flight job must survive because a caller
    // is still polling it.
    for (let i = 0; i < 4; i++) {
      const filler = jobs.create();
      jobs.update(filler, { status: "failed" });
    }

    assert.equal(jobs.get(running).status, "rendering");
  });
});
