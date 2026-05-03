/**
 * Reconcile OpenClaw's `openclaw.json` after the container regenerates it.
 *
 * Why this exists: every time OpenClaw boots without a valid auth token it
 * regenerates one and re-seeds `gateway.controlUi.allowedOrigins` to the
 * localhost-only defaults. After `eve update` (image pull + restart) the
 * volume-mounted config can come back trimmed — and the user's public
 * domain (`https://openclaw.<host>`) is no longer in the allow-list, so
 * Traefik's route shows 502 "upstream not responding" even though the
 * container is up. Eve owns the public domain config (Traefik route is set
 * here) so Eve owns the reconciliation: read what's in the container, take
 * the UNION with what Eve expects, atomically write it back.
 *
 * Non-goals:
 *  - We don't restart the container. The caller does, only when something
 *    actually changed. This keeps the helper safe to call from `doctor` or
 *    other read-mostly paths without bouncing traffic.
 *  - We don't seed anything Eve doesn't own. User-added origins are
 *    preserved verbatim — set-union, never overwrite.
 *  - We don't synthesize a public origin when no domain is configured.
 *    Localhost variants are always merged; the public origin only when
 *    `secrets.domain.primary` is set.
 *  - No `jq` dependency: we parse + serialise in Node, then ship the new
 *    JSON to the container via `docker exec -i` stdin (so shell-escaping
 *    edge cases on the container side cannot corrupt the file).
 */

import { spawnSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Public contract
// ---------------------------------------------------------------------------

export interface OpenclawReconcileBefore {
  /** Origins as found in the container's config when we read it. */
  allowedOrigins: string[];
  /**
   * True when we observed evidence of an auth-token regeneration on this
   * boot — currently inferred only by reading `gateway.auth.token` shape;
   * we don't peek at logs. Reserved for future telemetry. Today we leave
   * this `false` — keep it in the contract so callers don't break when we
   * wire it up.
   */
  authTokenChanged: boolean;
}

export interface OpenclawReconcileAfter {
  /** Origins after the union (= what's in the file when we return). */
  allowedOrigins: string[];
}

export interface OpenclawReconcileResult {
  /** True if we actually wrote a new file (i.e. container needs a kick). */
  changed: boolean;
  before: OpenclawReconcileBefore;
  after: OpenclawReconcileAfter;
  /**
   * Human-readable lines describing what happened (or didn't). Always
   * populated, even on the no-op path — useful for status output.
   * The CLI shows the first line, verbose surfaces show all.
   */
  notes: string[];
}

export interface OpenclawReconcileOptions {
  /** Public domain (`secrets.domain.primary`). Optional — see notes. */
  domain?: string;
  /** Override the container name. Default `eve-arms-openclaw`. */
  containerName?: string;
  /** Override the in-container config path. */
  configPath?: string;
  /**
   * Treat the run as a no-op if the container is missing/down. Default
   * `true` — we don't want post-update or doctor calls to fail loudly
   * just because OpenClaw wasn't installed on this host.
   */
  skipIfContainerMissing?: boolean;
}

// ---------------------------------------------------------------------------
// Constants — keep the canonical Eve allow-list in one place
// ---------------------------------------------------------------------------

const DEFAULT_CONTAINER = "eve-arms-openclaw";
const DEFAULT_CONFIG_PATH = "/home/node/.openclaw/openclaw.json";

/**
 * Origins Eve always wants in OpenClaw's allow-list, regardless of public
 * domain. These are what OpenClaw seeds itself in `bind=auto` mode and
 * preserving them keeps the local-only flow working alongside the public
 * one.
 */
const ALWAYS_INCLUDE_ORIGINS: readonly string[] = [
  "http://localhost:18789",
  "http://127.0.0.1:18789",
];

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Reconcile OpenClaw's `gateway.controlUi.allowedOrigins`.
 *
 * Idempotent: running twice with no input changes between calls returns
 * `changed: false` both times and does not touch the file. Safe to call
 * from `eve update`, `eve doctor`, or a manual `eve mode reconcile-openclaw`.
 */
export async function reconcileOpenclawConfig(
  opts: OpenclawReconcileOptions = {},
): Promise<OpenclawReconcileResult> {
  const containerName = opts.containerName ?? DEFAULT_CONTAINER;
  const configPath = opts.configPath ?? DEFAULT_CONFIG_PATH;
  const skipIfMissing = opts.skipIfContainerMissing ?? true;

  // 1. Container running? If not, this is a no-op (the container's volume
  //    is what holds the config — we can't touch the file otherwise). We
  //    still return a structured result so callers can render a useful
  //    note rather than treating it as an error.
  if (!isContainerRunning(containerName)) {
    const note = skipIfMissing
      ? `${containerName} is not running — skipping reconciliation`
      : `${containerName} is not running`;
    return {
      changed: false,
      before: { allowedOrigins: [], authTokenChanged: false },
      after: { allowedOrigins: [] },
      notes: [note],
    };
  }

  // 2. Read the current config from inside the container. We use docker
  //    exec + cat instead of bind-mounting a host path so we don't have
  //    to know the volume layout — works whether the container uses an
  //    anonymous volume, a named volume, or a bind-mount.
  const readResult = readContainerJson(containerName, configPath);
  if (readResult.kind === "error") {
    return {
      changed: false,
      before: { allowedOrigins: [], authTokenChanged: false },
      after: { allowedOrigins: [] },
      notes: [`could not read ${configPath}: ${readResult.message}`],
    };
  }

  const config = readResult.value;
  const currentOrigins = readAllowedOrigins(config);

  // 3. Compute Eve's expected origins. Always-include list first, then the
  //    public origin if a domain is configured. We always assume HTTPS for
  //    the public side (Traefik is the only TLS-terminating front for Eve);
  //    a plain HTTP origin would only show up if someone is testing locally
  //    against a non-TLS Traefik, which is rare enough that the merge step
  //    handles it (the user-added http origin is preserved by the union).
  const expectedOrigins = [...ALWAYS_INCLUDE_ORIGINS];
  const notes: string[] = [];
  if (opts.domain && opts.domain.trim().length > 0) {
    expectedOrigins.push(buildPublicOrigin(opts.domain.trim()));
  } else {
    notes.push("no public domain configured — only localhost origins reconciled");
  }

  // 4. Union: keep everything we found, add anything Eve expects but the
  //    container hasn't seeded yet. Order: existing entries first (preserves
  //    user/OpenClaw ordering for stable diffs), then the new ones in the
  //    order Eve declared them. De-dup by raw string match — origins with
  //    trailing slashes / case differences are intentionally treated as
  //    distinct because OpenClaw's CORS check is also a raw string match.
  const merged = unionInOrder(currentOrigins, expectedOrigins);
  const added = merged.filter(o => !currentOrigins.includes(o));

  // 5. Did anything change? Same length AND same content (in any order)
  //    means there's nothing to write. Order changes alone don't trigger a
  //    write — OpenClaw's check is order-insensitive.
  if (added.length === 0) {
    notes.unshift("allowedOrigins already in sync");
    return {
      changed: false,
      before: { allowedOrigins: currentOrigins, authTokenChanged: false },
      after: { allowedOrigins: currentOrigins },
      notes,
    };
  }

  // 6. Write the new config back. Atomic: write to /tmp then `mv` so a
  //    crash mid-write doesn't leave OpenClaw with a half-truncated JSON.
  //    We also keep the rest of the config object exactly as-is — we only
  //    own this one field.
  const nextConfig = setAllowedOrigins(config, merged);
  const writeResult = writeContainerJson(containerName, configPath, nextConfig);
  if (writeResult.kind === "error") {
    return {
      changed: false,
      before: { allowedOrigins: currentOrigins, authTokenChanged: false },
      after: { allowedOrigins: currentOrigins },
      notes: [
        ...notes,
        `could not write ${configPath}: ${writeResult.message}`,
      ],
    };
  }

  notes.unshift(
    `re-added ${added.length} entr${added.length === 1 ? "y" : "ies"} to allowedOrigins: ${added.join(", ")}`,
  );

  return {
    changed: true,
    before: { allowedOrigins: currentOrigins, authTokenChanged: false },
    after: { allowedOrigins: merged },
    notes,
  };
}

// ---------------------------------------------------------------------------
// Helpers — narrow, no exports outside the module
// ---------------------------------------------------------------------------

/**
 * Read `gateway.controlUi.allowedOrigins` from a parsed config.
 *
 * Tolerates absent intermediates: `gateway` missing, `controlUi` missing,
 * `allowedOrigins` missing or non-array all collapse to `[]`. Any non-string
 * entry is dropped silently — the file is owned by OpenClaw's seeding
 * code, so a non-string here is a bug at their layer and we don't want
 * to propagate it.
 */
function readAllowedOrigins(config: unknown): string[] {
  if (!config || typeof config !== "object") return [];
  const c = config as Record<string, unknown>;
  const gateway = c.gateway;
  if (!gateway || typeof gateway !== "object") return [];
  const controlUi = (gateway as Record<string, unknown>).controlUi;
  if (!controlUi || typeof controlUi !== "object") return [];
  const list = (controlUi as Record<string, unknown>).allowedOrigins;
  if (!Array.isArray(list)) return [];
  return list.filter((v): v is string => typeof v === "string");
}

/**
 * Return a deep-cloned config with `gateway.controlUi.allowedOrigins`
 * replaced. We deep-clone to avoid mutating the parsed object the caller
 * still holds a reference to (cheap — these files are tiny).
 */
function setAllowedOrigins(config: unknown, origins: string[]): Record<string, unknown> {
  // structuredClone is available on Node 18+. JSON.parse(JSON.stringify(x))
  // is a fine fallback because we already know the input is JSON-derived.
  const clone = (typeof structuredClone === "function"
    ? structuredClone(config)
    : JSON.parse(JSON.stringify(config ?? {}))) as Record<string, unknown>;
  const obj: Record<string, unknown> = clone && typeof clone === "object" ? clone : {};
  if (!obj.gateway || typeof obj.gateway !== "object") obj.gateway = {};
  const gateway = obj.gateway as Record<string, unknown>;
  if (!gateway.controlUi || typeof gateway.controlUi !== "object") gateway.controlUi = {};
  const controlUi = gateway.controlUi as Record<string, unknown>;
  controlUi.allowedOrigins = [...origins];
  return obj;
}

/** Build the canonical public origin Eve wants in the allow-list. */
function buildPublicOrigin(domain: string): string {
  // Strip an accidental scheme/path the user might have stored in
  // `secrets.domain.primary`. We need a bare host here.
  const host = domain
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "");
  return `https://openclaw.${host}`;
}

/**
 * Union two arrays preserving the order of `first`, then appending entries
 * from `second` that aren't already present (by raw equality). De-dupes
 * within `first` too in case the file already had duplicates.
 */
function unionInOrder(first: string[], second: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of first) {
    if (!seen.has(v)) { seen.add(v); out.push(v); }
  }
  for (const v of second) {
    if (!seen.has(v)) { seen.add(v); out.push(v); }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Docker shims — kept tiny on purpose. We use spawnSync for synchronous
// readability; everything we run completes in well under a second.
// ---------------------------------------------------------------------------

/**
 * True if a container with that name is currently running. We pipe stderr
 * to ignore so a missing-docker host fails to "false" without log spam —
 * the caller already prints a useful no-op note.
 */
function isContainerRunning(name: string): boolean {
  const r = spawnSync(
    "docker",
    ["ps", "--filter", `name=^${name}$`, "--format", "{{.Names}}"],
    { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"], timeout: 4000 },
  );
  if (r.status !== 0) return false;
  return (r.stdout ?? "").trim() === name;
}

type ReadResult =
  | { kind: "ok"; value: unknown }
  | { kind: "error"; message: string };

/**
 * Read a JSON file from inside a running container. Returns the parsed
 * value on success, an error result on any failure (missing file, parse
 * error, docker unreachable). The caller renders the error inline rather
 * than throwing because reconcile is best-effort.
 */
function readContainerJson(container: string, path: string): ReadResult {
  const r = spawnSync(
    "docker",
    ["exec", container, "cat", path],
    { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], timeout: 4000 },
  );
  if (r.status !== 0) {
    const stderr = (r.stderr ?? "").toString().trim();
    return { kind: "error", message: stderr.length > 0 ? stderr : `cat exited ${r.status}` };
  }
  const text = r.stdout ?? "";
  if (text.trim().length === 0) {
    // Empty file: treat as `{}` so reconciliation can proceed and write
    // the missing keys. Mirrors what OpenClaw itself does on first boot.
    return { kind: "ok", value: {} };
  }
  try {
    return { kind: "ok", value: JSON.parse(text) };
  } catch (err) {
    return { kind: "error", message: err instanceof Error ? err.message : String(err) };
  }
}

type WriteResult =
  | { kind: "ok" }
  | { kind: "error"; message: string };

/**
 * Atomically write a JSON file inside a container.
 *
 * Strategy: pipe the new JSON over stdin into `cat > /tmp/openclaw.json.eve`
 * inside the container, then `mv` it over the destination. The `mv` is
 * atomic on the same filesystem (POSIX rename), so a crash between the two
 * steps either leaves the original file intact (write failed) or replaces
 * it cleanly (write succeeded). Mode is preserved by `mv`; if the source
 * is created fresh we set 0600 to match what OpenClaw itself uses.
 */
function writeContainerJson(container: string, path: string, value: unknown): WriteResult {
  const json = JSON.stringify(value, null, 2);
  const tmpPath = `${path}.eve-reconcile.tmp`;

  // Write the staging file via stdin pipe — avoids any shell quoting on the
  // container side (the JSON might contain newlines, quotes, etc.).
  const writeR = spawnSync(
    "docker",
    ["exec", "-i", container, "sh", "-c", `cat > ${shellEscape(tmpPath)} && chmod 600 ${shellEscape(tmpPath)}`],
    { input: json, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"], timeout: 6000 },
  );
  if (writeR.status !== 0) {
    return {
      kind: "error",
      message: ((writeR.stderr ?? "") as string).toString().trim() || `cat exited ${writeR.status}`,
    };
  }

  const moveR = spawnSync(
    "docker",
    ["exec", container, "mv", tmpPath, path],
    { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], timeout: 4000 },
  );
  if (moveR.status !== 0) {
    // Clean up the staging file so a second run isn't confused by it.
    spawnSync("docker", ["exec", container, "rm", "-f", tmpPath], { stdio: "ignore", timeout: 4000 });
    return {
      kind: "error",
      message: ((moveR.stderr ?? "") as string).toString().trim() || `mv exited ${moveR.status}`,
    };
  }
  return { kind: "ok" };
}

/**
 * Conservative shell-escape — only used for our own `tmpPath` which is a
 * derived constant + suffix we control. Belt-and-braces so any future
 * caller passing a weirder path doesn't break.
 */
function shellEscape(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
