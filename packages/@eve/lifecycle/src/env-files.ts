/**
 * Tiny KEY=VALUE .env file reader/writer for component deploy dirs.
 *
 * Used by `eve mode` (and anyone else flipping a single env var on a
 * compose-based component) so we don't sprinkle hand-rolled `readFile +
 * regex + writeFile` blocks across the codebase. Atomic on write — we
 * write a sibling temp file with mode 0600 then `rename()` it over the
 * target so a Ctrl-C mid-write never leaves the operator with a
 * truncated `.env` (which would silently kill every container that
 * sources it).
 *
 * Deliberate non-goals:
 *  - No quoted-value parsing. Compose `.env` files are mostly literal
 *    `KEY=value` and that's all our callers need today. If a value has
 *    leading/trailing spaces or quotes, this helper preserves them
 *    on read but does not unescape them — keep it boring.
 *  - No interpolation (`${OTHER_VAR}`) handling. Compose interprets
 *    those at compose-time; we just round-trip the raw text.
 *  - No comment-as-value preservation: we keep comment LINES and blank
 *    lines verbatim, but we don't track inline `KEY=value # comment`
 *    side-comments. None of our generated files emit those.
 */

import {
  readFileSync,
  writeFileSync,
  renameSync,
  existsSync,
  mkdirSync,
  unlinkSync,
} from "node:fs";
import { join, dirname } from "node:path";

const ENV_FILENAME = ".env";

function envPath(deployDir: string): string {
  return join(deployDir, ENV_FILENAME);
}

/**
 * Read a single env var's value from `<deployDir>/.env`.
 *
 * Returns `null` when the file is missing OR the key isn't present —
 * callers usually treat both as "default / unset". When the same key
 * appears multiple times we honor the LAST occurrence to match the
 * behaviour of `set -a; source .env` and docker-compose.
 */
export function readEnvVar(deployDir: string, key: string): string | null {
  const path = envPath(deployDir);
  if (!existsSync(path)) return null;

  const text = readFileSync(path, "utf-8");
  let last: string | null = null;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trimStart();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    if (line.slice(0, eq).trim() === key) {
      last = line.slice(eq + 1);
    }
  }
  return last;
}

/**
 * Read every key=value pair from `<deployDir>/.env`. Order-preserved
 * Map so `for...of` iteration matches file order. Last-write wins on
 * duplicate keys (same as `readEnvVar`).
 */
export function readEnvFile(deployDir: string): Map<string, string> {
  const path = envPath(deployDir);
  const out = new Map<string, string>();
  if (!existsSync(path)) return out;

  const text = readFileSync(path, "utf-8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trimStart();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    if (!k) continue;
    out.set(k, line.slice(eq + 1));
  }
  return out;
}

export interface WriteEnvVarResult {
  /** True if the file was actually rewritten. False = value already matched. */
  changed: boolean;
  /** Previous value, or null if the key didn't exist. */
  previous: string | null;
}

/**
 * Set (or unset) a single env var in `<deployDir>/.env`. Idempotent —
 * if the value already matches, returns `{changed: false}` without
 * touching the file (so callers can decide whether to recreate the
 * container).
 *
 * Pass `value === null` to remove the key entirely. The `.env` file
 * is created with mode 0600 if it doesn't exist (matches the install
 * recipes' convention).
 *
 * Atomic: writes to `<path>.tmp-<pid>` then `rename()`s. On any error
 * the temp file is best-effort cleaned up — the original is never
 * partially overwritten.
 */
export function writeEnvVar(
  deployDir: string,
  key: string,
  value: string | null,
): WriteEnvVarResult {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    throw new Error(`writeEnvVar: invalid env var name ${JSON.stringify(key)}`);
  }

  const path = envPath(deployDir);
  // Make the parent dir on demand — install recipes always create it,
  // but `eve mode` may run before re-install and we shouldn't refuse
  // to set a flag on a deploy dir we manage.
  if (!existsSync(dirname(path))) {
    mkdirSync(dirname(path), { recursive: true });
  }

  const existed = existsSync(path);
  const original = existed ? readFileSync(path, "utf-8") : "";
  const hadTrailingNewline = original.endsWith("\n");

  let previous: string | null = null;
  let found = false;
  // Strip a single trailing newline so split() doesn't produce a
  // sentinel empty element that we'd then have to special-case
  // when re-joining. We re-add the trailing newline at the end.
  const sourceText = hadTrailingNewline ? original.slice(0, -1) : original;
  const lines = sourceText === "" ? [] : sourceText.split(/\r?\n/);

  // Walk every line; rewrite the first match, drop later duplicates,
  // preserve everything else verbatim. (Duplicate-drop matters: leaving
  // a stale older line behind would let it shadow our new value depending
  // on docker-compose's parser quirks.)
  const out: string[] = [];
  for (const line of lines) {
    const trimmed = line.trimStart();
    if (!trimmed || trimmed.startsWith("#")) {
      out.push(line);
      continue;
    }
    const eq = line.indexOf("=");
    if (eq < 0) {
      out.push(line);
      continue;
    }
    const k = line.slice(0, eq).trim();
    if (k !== key) {
      out.push(line);
      continue;
    }
    // Match.
    const val = line.slice(eq + 1);
    if (!found) {
      previous = val;
      found = true;
      if (value !== null) {
        out.push(`${key}=${value}`);
      }
      // value === null → drop (don't push)
    }
    // Subsequent duplicates: drop unconditionally.
  }

  if (!found && value !== null) {
    out.push(`${key}=${value}`);
  }

  // Re-emit. Always finish with a trailing newline — every well-formed
  // .env file ends in `\n`. If the result is empty (last key removed
  // from a single-key file) emit an empty file with no newline.
  let next = out.join("\n");
  if (next.length > 0) next += "\n";

  if (existed && next === original) {
    return { changed: false, previous };
  }

  // Atomic write: temp + rename. The temp filename includes the pid so
  // two concurrent eve invocations don't clobber each other's temps.
  const tmp = `${path}.tmp-${process.pid}`;
  try {
    writeFileSync(tmp, next, { mode: 0o600 });
    renameSync(tmp, path);
  } catch (err) {
    try { unlinkSync(tmp); } catch { /* not ours to mourn */ }
    throw err;
  }

  return { changed: true, previous };
}
