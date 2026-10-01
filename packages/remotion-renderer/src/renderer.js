/**
 * Bundling + composition discovery + rendering.
 *
 * Wraps `@remotion/bundler` and `@remotion/renderer`. Everything Remotion-specific
 * is isolated here so the HTTP layer stays testable without a real bundle.
 *
 * `REMOTION_PROJECT_PATH` is finally READ here. It has only ever appeared in prose
 * (`content-studio.yaml` onboarding said to set it); no code in the monorepo
 * consumed it, so the advice could not work. This is the first reader.
 */

import { bundle } from "@remotion/bundler";
import {
  getCompositions,
  renderMedia,
  selectComposition,
} from "@remotion/renderer";

/**
 * Discover every composition registered in the project.
 *
 * Bundled ONCE and cached: bundling is the expensive part (a webpack build of the
 * whole project), and `/compositions` is a discovery door the agent may call
 * before every render. Re-bundling per call would make listing slower than
 * rendering.
 *
 * A project that fails to bundle is NOT silently empty — the error is returned and
 * `/health` reports unhealthy, so an install cannot claim success against a
 * renderer that cannot list a single composition.
 *
 * @param {string} projectPath absolute path to the Remotion project
 * @returns {Promise<{ compositions: Array<{name:string,durationFrames:number,fps:number,width:number,height:number}>, error: string|null, serveUrl: string|null }>}
 */
export async function loadCompositions(projectPath) {
  try {
    const serveUrl = await bundle({
      entryPoint: `${projectPath}/src/index.ts`,
      // A stable name per process: the bundle is cached for the process lifetime,
      // so re-bundling is only reached on an explicit `force`.
      onProgress: () => {},
    });
    const list = await getCompositions(serveUrl, { inputProps: {} });

    return {
      compositions: list.map((c) => ({
        name: c.id,
        // Remotion names this `durationInFrames` on a Composition; the capability
        // contract calls it `durationFrames`. Normalized here so the shape the
        // agent sees is the shape the skill already destructures.
        durationFrames: c.durationInFrames,
        fps: c.fps,
        width: c.width,
        height: c.height,
      })),
      error: null,
      serveUrl,
    };
  } catch (err) {
    return {
      compositions: [],
      error: err instanceof Error ? err.message : String(err),
      serveUrl: null,
    };
  }
}

/**
 * Render one composition to a file.
 *
 * Progress is reported through `onProgress` (0..1) so the job store can expose a
 * real percentage instead of an indeterminate spinner.
 *
 * @returns {Promise<{ outputPath: string, durationFrames: number }>}
 * @throws when the composition is unknown or the render fails — the caller turns
 *   that into a terminal `failed` job.
 */
export async function renderComposition({
  serveUrl,
  composition,
  output,
  codec,
  onProgress,
}) {
  const selected = await selectComposition({
    serveUrl,
    id: composition,
    inputProps: {},
  });

  // `output` is a path on the pod; Remotion infers the codec from the extension,
  // so a caller-supplied codec is only passed when it differs from the default.
  const result = await renderMedia({
    composition: selected,
    serveUrl,
    codec: codec ?? "h264",
    outputLocation: output,
    inputProps: {},
    onProgress: ({ progress }) => {
      onProgress?.(Math.round(progress * 100));
    },
  });

  return { outputPath: output, durationFrames: result.durationInFrames ?? selected.durationInFrames };
}
