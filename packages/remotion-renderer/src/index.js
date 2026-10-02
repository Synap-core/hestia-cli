/**
 * Entry point.
 *
 * Reads `REMOTION_PROJECT_PATH` (defaulting to `/opt/remotion`), bundles the
 * project once at boot so the first `/compositions` is instant, and serves.
 */

import { createRendererServer } from "./server.js";
import { loadCompositions, renderComposition } from "./renderer.js";

const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? "0.0.0.0";
const PROJECT_PATH = process.env.REMOTION_PROJECT_PATH ?? "/opt/remotion";
const API_TOKEN = process.env.REMOTION_API_TOKEN || undefined;

const log = (msg) => process.stderr.write(`[remotion-renderer] ${msg}\n`);

const { server } = createRendererServer({
  projectPath: PROJECT_PATH,
  apiToken: API_TOKEN,
  // BOUND, not passed bare: the server calls `loadCompositions()` with no
  // argument on every /health and /compositions, so passing the function
  // directly gave it `projectPath === undefined` and it tried to bundle
  // "/app/undefined/src/index.ts". The boot call below passed PROJECT_PATH
  // explicitly and worked, which is exactly why the failure looked like it
  // came and went between requests.
  loadCompositions: () => loadCompositions(PROJECT_PATH),
  renderComposition,
  log,
});

// Warm the bundle at boot so `/health` is meaningful immediately and the first
// render does not pay the webpack cost. A failure here is NOT fatal — the service
// still starts and `/health` reports the error, which is what an installer needs
// to see.
log(`bundling project at ${PROJECT_PATH}…`);
const { compositions, error } = await loadCompositions(PROJECT_PATH);
if (error) log(`WARNING: project failed to bundle: ${error}`);
else log(`ready — ${compositions.length} composition(s): ${compositions.map((c) => c.name).join(", ")}`);

server.listen(PORT, HOST, () => {
  log(`listening on ${HOST}:${PORT}`);
});
