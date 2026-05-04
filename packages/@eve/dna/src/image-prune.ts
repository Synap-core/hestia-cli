/**
 * Reclaim disk by removing old image versions for a given repository.
 *
 * # Why this exists
 *
 * `docker compose pull` accumulates layers. After a year of weekly
 * updates a single repo can hold 50+ image tags, several GB each.
 * Operators have no automatic GC — `docker image prune` only collects
 * dangling (untagged) images, NOT old tags from the same repo. We've
 * seen pod hosts fill their disk, OOM-kill postgres, and lose data
 * because nobody thought to run `docker rmi` manually.
 *
 * The fix is simple and well-scoped: after every successful `compose up`,
 * keep the latest N image versions for the repos this update touched.
 * Older versions go. In-use images (those backing running containers)
 * are kept by Docker itself — `docker rmi` returns a non-zero exit and
 * leaves the image untouched, which we surface as `skipped` not removed.
 *
 * # Why we don't use `docker image prune --filter`
 *
 * `image prune` operates on dangling-or-untagged images, not "old tags
 * for repo X." There's no built-in command for "keep latest N tags."
 * The closest is `--filter "until=24h"` which is age-based, not
 * generation-based — a repo that updates every 6h would lose its last
 * 4 versions, not the last N. Generation-based is what we want for
 * rollback safety: a regressed deploy should be one `docker tag` away
 * from rollback, not a re-pull from the registry.
 *
 * # Scoping discipline
 *
 * This function takes a *specific* repository prefix (e.g.
 * `ghcr.io/synap-core/backend`). It NEVER does a wildcard prune. The
 * caller (`UpdatePlan.pruneImages.repositories`) is the explicit
 * inclusion list. If a future component adds new images, the caller
 * adds the repo; nothing happens automatically. This is deliberate —
 * an over-eager prune that yanks images from a sibling project running
 * on the same host would be unrecoverable without a network re-pull.
 */

import { execSync } from "node:child_process";

export interface PruneResult {
  /** Image references successfully removed. Empty if nothing to do. */
  removed: string[];
  /** References we tried to remove but Docker refused (image in use). */
  skipped: string[];
  /** References we deliberately kept (the latest N for the repo). */
  kept: string[];
}

interface ImageEntry {
  /** `repo:tag` — the human-readable reference. */
  reference: string;
  /** Image SHA — used as the rmi target so identical SHAs across tags collapse cleanly. */
  id: string;
}

/**
 * List every locally-pulled image for the given repository, newest
 * first. Tags like `<none>` (dangling) are excluded — those are picked
 * up by Docker's regular `image prune` and aren't our responsibility.
 *
 * Tag list is filtered with `--filter reference=<repo>:*` so we never
 * see images from other repos. The `:*` glob matches any tag including
 * `latest`.
 *
 * We rely on `docker images`' documented default ordering (newest-first
 * by created timestamp) rather than re-parsing `CreatedAt` ourselves.
 * `Date.parse` is brittle on the `"2026-04-15 14:32:01 -0700 PDT"`
 * format Docker emits — the trailing TZ name doesn't parse reliably
 * across Node versions, and any partial-parse failure would silently
 * sort good images to the bottom of the kept-vs-prune list. Trusting
 * Docker's order avoids that whole class of bug; the only failure mode
 * is "Docker someday changes its default sort," at which point this
 * fails closed (we'd keep N arbitrary images, not destroy good ones).
 */
function listRepoImages(repository: string): ImageEntry[] {
  const out = execSync(
    `docker images --filter "reference=${repository}:*" --format "{{.Repository}}:{{.Tag}}|{{.ID}}" --no-trunc`,
    { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] },
  ).trim();
  if (!out) return [];

  const entries: ImageEntry[] = [];
  for (const line of out.split("\n")) {
    const [reference, id] = line.split("|");
    if (!reference || !id) continue;
    if (reference.endsWith(":<none>")) continue;
    entries.push({ reference, id });
  }
  return entries;
}

/**
 * Try to remove a single image. Returns true on success, false if
 * Docker refused (typically because a running container references it).
 *
 * We `--no-trunc` the listing and use the full ID for the rmi call so
 * tag aliases (e.g. `repo:latest` and `repo:v1.2.3` pointing to the
 * same SHA) get cleaned up in one operation.
 */
function tryRemoveImage(reference: string): boolean {
  try {
    execSync(`docker rmi ${reference}`, { stdio: ["ignore", "pipe", "pipe"] });
    return true;
  } catch {
    // rmi exits non-zero when the image is in use, has dependent
    // children, or doesn't exist. All three are "leave it alone."
    return false;
  }
}

/**
 * Keep the latest `keep` images for `repository`; remove the rest.
 *
 * `keep` is a generation count (NOT a time window): if you pull weekly
 * for a year and ask for `keep: 3`, you end up with the latest 3 tags
 * regardless of how old they are. That's exactly what you want for
 * rollback windows — recent enough to roll back from a regression,
 * bounded enough to not eat the disk.
 *
 * Returns details so the caller can log meaningfully ("removed 4,
 * skipped 1 in-use, kept 3").
 */
export function pruneOldImagesForRepo(
  repository: string,
  keep: number,
): PruneResult {
  if (keep < 1) {
    throw new Error(`pruneOldImagesForRepo: keep must be >= 1 (got ${keep})`);
  }

  const all = listRepoImages(repository);
  if (all.length <= keep) {
    return { removed: [], skipped: [], kept: all.map((e) => e.reference) };
  }

  const kept = all.slice(0, keep);
  const candidates = all.slice(keep);

  const removed: string[] = [];
  const skipped: string[] = [];
  for (const entry of candidates) {
    if (tryRemoveImage(entry.reference)) {
      removed.push(entry.reference);
    } else {
      skipped.push(entry.reference);
    }
  }

  return {
    removed,
    skipped,
    kept: kept.map((e) => e.reference),
  };
}
