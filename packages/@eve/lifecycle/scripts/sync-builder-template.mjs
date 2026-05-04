/**
 * Build-time sync helper for the Builder workspace template.
 *
 * Source of truth: `synap-backend/templates/builder-workspace.json`.
 * Bundled copy:    `packages/@eve/lifecycle/assets/templates/builder-workspace.json`.
 *
 * The bundled copy is what `ensureBuilderWorkspace()` reads at runtime —
 * Eve must work without the synap-backend repo present on the user's
 * machine. This script keeps the two in sync during local development:
 * run it after touching the source template (or just before publishing
 * @eve/lifecycle) and the assets dir gets refreshed.
 *
 * Cheap by design: a missing source repo is a no-op (warn + exit 0),
 * not a build failure. Production builds run on machines with the
 * monorepo present, so the sync just works; outsiders building only
 * the `hestia-cli` workspace get the last-checked-in copy from the
 * assets dir.
 *
 * Usage (from anywhere in the monorepo):
 *
 *   pnpm --filter @eve/lifecycle sync-builder-template
 *
 * or directly:
 *
 *   node packages/@eve/lifecycle/scripts/sync-builder-template.mjs
 */

import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, "..");
const monorepoRoot = resolve(pkgRoot, "..", "..", "..", ".."); // packages/@eve/lifecycle/scripts → repo root
const synapRepoRoot = process.env.SYNAP_REPO_ROOT
  ? resolve(process.env.SYNAP_REPO_ROOT)
  : resolve(monorepoRoot, "..", "synap-backend");

const sourcePath = join(
  synapRepoRoot,
  "templates",
  "builder-workspace.json",
);
const targetDir = join(pkgRoot, "assets", "templates");
const targetPath = join(targetDir, "builder-workspace.json");

function main() {
  if (!existsSync(sourcePath)) {
    console.warn(
      `[sync-builder-template] source not found at ${sourcePath} — keeping bundled copy as-is. ` +
        `Set SYNAP_REPO_ROOT to point at your synap-backend checkout if you want to refresh it.`,
    );
    process.exit(0);
  }

  mkdirSync(targetDir, { recursive: true });
  copyFileSync(sourcePath, targetPath);
  console.log(
    `[sync-builder-template] copied ${sourcePath} → ${targetPath}`,
  );
}

main();
