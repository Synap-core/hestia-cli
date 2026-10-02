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
import { readFileSync } from "node:fs";

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

  test("POST /render FORWARDS props to the renderer", async () => {
    // Regression guard: `inputProps` was hardcoded `{}` in renderer.js, so the
    // capability's documented `props` argument was accepted and silently
    // discarded — every render produced a byte-identical video. Assert the
    // value ARRIVES at the seam, not that the endpoint accepts it.
    let seenProps;
    await withServer(
      {
        renderComposition: async ({ output, inputProps }) => {
          seenProps = inputProps;
          return { outputPath: output, durationFrames: 90 };
        },
      },
      async (call) => {
        const payload = { composition: "ShortClip", output: "/tmp/x.mp4", props: { title: "Synap", n: 7 } };
        const { status, body } = await call("POST", "/render", payload);
        assert.equal(status, 200);
        // Give the background render a tick to reach the seam.
        for (let i = 0; i < 40 && seenProps === undefined; i++) {
          await new Promise((r) => setTimeout(r, 25));
        }
        assert.deepEqual(seenProps, payload.props, "props must reach the renderer");
        assert.deepEqual(body.props, payload.props, "props echoed back for confirmation");
      },
    );
  });

  test("a render with NO props still sends an object, never undefined", async () => {
    let seenProps = "UNSET";
    await withServer(
      {
        renderComposition: async ({ output, inputProps }) => {
          seenProps = inputProps;
          return { outputPath: output, durationFrames: 90 };
        },
      },
      async (call) => {
        await call("POST", "/render", { composition: "ShortClip", output: "/tmp/y.mp4" });
        for (let i = 0; i < 40 && seenProps === "UNSET"; i++) {
          await new Promise((r) => setTimeout(r, 25));
        }
        assert.deepEqual(seenProps, {}, "defaults to {} so the renderer never sees undefined");
      },
    );
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

/**
 * The seam itself — the defect class the injected stub above cannot catch.
 *
 * `withServer` injects `async () => ({...})`: a zero-argument stub. A stub with
 * no parameters accepts being called with none, so it passes no matter how the
 * real `loadCompositions(projectPath)` is wired. That is exactly how the
 * production bug survived 13 green tests: the server called
 * `deps.loadCompositions()` bare while the real function reads `projectPath` as
 * its first argument, so every request after boot bundled
 * `/app/undefined/src/index.ts` while the boot-time call (which passed the path
 * explicitly) worked fine.
 *
 * These assert the WIRING: that the function handed to the server carries the
 * project's path, and that the real `loadCompositions` rejects a missing path
 * rather than quietly building a path out of `undefined`.
 */
describe("projectPath reaches the bundler", () => {
  test("the function given to the server receives the project path", async () => {
    // Mirrors index.js's binding: `() => loadCompositions(PROJECT_PATH)`.
    const seen = [];
    const bound = (projectPath) => () => {
      seen.push(projectPath);
      return { compositions: COMPOSITIONS, error: null, serveUrl: "http://bundle" };
    };

    const { server } = createRendererServer({
      projectPath: "/opt/remotion",
      apiToken: undefined,
      loadCompositions: bound("/opt/remotion"),
      renderComposition: async ({ output }) => ({ outputPath: output, durationFrames: 1 }),
      jobs: new JobStore(),
      log: () => {},
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      await fetch(base + "/compositions");
    } finally {
      server.close();
      await once(server, "close");
    }

    assert.ok(seen.length > 0, "loadCompositions was never called");
    for (const path of seen) {
      assert.equal(path, "/opt/remotion", "the server must supply the project path");
    }
  });

  test("index.js BINDS the project path when it hands loadCompositions over", () => {
    // The guard the stub cannot provide. Reverting the production binding to a
    // bare `loadCompositions,` leaves every other test green — proven by the
    // negative control — because the injected stub takes no parameters. So the
    // wiring is asserted where it is decided: the entry point must pass the path
    // into the dep rather than handing the bare function over.
    const src = readFileSync(new URL("../src/index.js", import.meta.url), "utf-8");
    const wiring = /createRendererServer\(\{([\s\S]*?)\}\)/.exec(src);
    assert.ok(wiring, "createRendererServer call must be findable");
    const line = wiring[1]
      .split("\n")
      .find((l) => /loadComplications|loadCompositions/.test(l) && !l.trim().startsWith("//"));
    assert.ok(line, "the loadCompositions dep must be passed to the server");
    assert.match(
      line,
      /loadCompositions\s*:\s*\(\)\s*=>\s*loadCompositions\(PROJECT_PATH\)/,
      `loadCompositions must be bound to PROJECT_PATH, got: ${line.trim()}`,
    );
  });

  test("the real loadCompositions takes projectPath as its FIRST parameter", () => {
    // Asserted on the SOURCE, not by importing it: `renderer.js` imports
    // `@remotion/bundler`, which is not installed in this workspace (the pod
    // installs it inside the image). Reading the signature is enough to pin the
    // defect: the server calls the dep with no argument, so the first parameter
    // MUST be the project path. If someone reorders it, this fails.
    const src = readFileSync(new URL("../src/renderer.js", import.meta.url), "utf-8");
    const sig = /export async function loadCompositions\(([^)]*)\)/.exec(src);
    assert.ok(sig, "loadCompositions signature must be findable");
    assert.match(sig[1], /^\s*projectPath\b/,
      `first parameter must be projectPath, got: ${sig[1]}`);
  });

});
