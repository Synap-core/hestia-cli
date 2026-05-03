/**
 * Eve auth subsystem — introspectable, renewable, self-healing.
 *
 * Why this exists: until now Eve treated the Synap agent API key as an
 * opaque, one-shot bootstrap value. Mint at install time, drop in
 * `secrets.json`, assume forever. When the key drifted (revoked, rotated,
 * scope stripped) Eve had no introspection — every failure became a
 * `cat secrets.json && docker exec wget` debug session.
 *
 * Two pieces:
 *   - `getAuthStatus()` — calls the new `GET /api/hub/auth/status` and
 *     returns either the structured key state OR a structured failure
 *     envelope (`key_revoked` | `expired` | `missing_scope` | …) the
 *     caller can switch on for concrete fix hints.
 *   - `renewAgentKey()` — re-runs the install-time mint path against
 *     `POST /api/hub/setup/agent`, atomically updates `secrets.json`,
 *     and returns the new prefix.
 *
 * Both consume the existing `IDoctorRunner` abstraction so the same code
 * works inside the dashboard (FetchRunner) and on the CLI host where
 * synap-backend has no host port mapping (FallbackRunner → docker exec).
 *
 * No new top-level dependencies. Built-in fetch via the runner;
 * `node:fs/promises` for atomic file writes; nothing else.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { readEveSecrets, secretsPath } from "@eve/dna";
import {
  FetchRunner,
  type IDoctorRunner,
} from "./diagnostics.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface AuthStatus {
  keyId: string;
  keyIdPrefix: string;
  userId: string;
  userEmail: string | null;
  userName: string | null;
  /** Human-readable agent name from the key row, distinct from userName. */
  name: string | null;
  scopes: string[];
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  /** Days since createdAt, computed client-side at call time. */
  ageDays: number;
  parentKeyId: string | null;
  isActive: true;
  /** Full body — for power-user inspection / debug logs. */
  raw: unknown;
}

export type AuthFailReason =
  | "key_revoked"
  | "missing_scope"
  | "expired"
  | "invalid_format"
  | "no_auth"
  | "transport"
  | "backend_unhealthy"
  | "unknown";

export interface AuthFailure {
  reason: AuthFailReason;
  httpStatus: number;
  message: string;
  /** Set when reason === "missing_scope". */
  missingScope?: string;
  /** Echoed by the backend when it knows which key was used. */
  keyIdPrefix?: string;
  /** Raw response body — for debug. May be unparseable. */
  raw?: unknown;
}

export type AuthResult =
  | { ok: true; status: AuthStatus }
  | { ok: false; failure: AuthFailure };

export interface GetAuthStatusOptions {
  synapUrl: string;
  apiKey: string;
  runner?: IDoctorRunner;
  timeoutMs?: number;
  signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// getAuthStatus — read /api/hub/auth/status, return either {ok} or {failure}
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 6_000;

export async function getAuthStatus(opts: GetAuthStatusOptions): Promise<AuthResult> {
  const synapUrl = opts.synapUrl.replace(/\/+$/, "");
  if (!synapUrl) {
    return {
      ok: false,
      failure: {
        reason: "no_auth",
        httpStatus: 0,
        message: "synapUrl not configured",
      },
    };
  }
  if (!opts.apiKey) {
    return {
      ok: false,
      failure: {
        reason: "no_auth",
        httpStatus: 0,
        message: "apiKey not configured",
      },
    };
  }

  const runner = opts.runner ?? new FetchRunner();
  const url = `${synapUrl}/api/hub/auth/status`;
  const headers = {
    Authorization: `Bearer ${opts.apiKey}`,
    Accept: "application/json",
  };

  const res = await runner.httpGet(url, headers, {
    signal: opts.signal,
    timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  });

  if (res.status === 0) {
    return {
      ok: false,
      failure: {
        reason: "transport",
        httpStatus: 0,
        message: res.error ?? "network error",
      },
    };
  }

  if (res.status >= 500) {
    return {
      ok: false,
      failure: {
        reason: "backend_unhealthy",
        httpStatus: res.status,
        message: `Backend returned ${res.status}`,
        raw: tryJson(res.body),
      },
    };
  }

  if (res.status === 401 || res.status === 403) {
    return parse401(res.status, res.body);
  }

  if (res.status === 404) {
    // Endpoint missing → backend is older than the auth-status contract.
    // Treat as backend_unhealthy so callers route the user to update.
    return {
      ok: false,
      failure: {
        reason: "backend_unhealthy",
        httpStatus: 404,
        message: "GET /api/hub/auth/status not available — backend version too old",
        raw: tryJson(res.body),
      },
    };
  }

  if (res.status < 200 || res.status >= 300) {
    return {
      ok: false,
      failure: {
        reason: "unknown",
        httpStatus: res.status,
        message: `Backend returned ${res.status}`,
        raw: tryJson(res.body),
      },
    };
  }

  // 2xx — parse the success envelope.
  const parsed = tryJson(res.body);
  if (!parsed || typeof parsed !== "object") {
    return {
      ok: false,
      failure: {
        reason: "unknown",
        httpStatus: res.status,
        message: "auth/status returned non-JSON body",
      },
    };
  }
  const body = parsed as Record<string, unknown>;
  const keyId = stringOr(body.keyId, "");
  const userId = stringOr(body.userId, "");
  const createdAtStr = stringOr(body.createdAt, "");
  if (!keyId || !userId || !createdAtStr) {
    return {
      ok: false,
      failure: {
        reason: "unknown",
        httpStatus: res.status,
        message: "auth/status payload missing required fields (keyId/userId/createdAt)",
        raw: parsed,
      },
    };
  }
  const ageDays = computeAgeDays(createdAtStr);
  const status: AuthStatus = {
    keyId,
    keyIdPrefix: stringOr(body.keyIdPrefix, keyId.slice(0, 8)),
    userId,
    userEmail: stringOrNull(body.userEmail),
    userName: stringOrNull(body.userName),
    name: stringOrNull(body.name),
    scopes: stringArray(body.scopes),
    createdAt: createdAtStr,
    expiresAt: stringOrNull(body.expiresAt),
    lastUsedAt: stringOrNull(body.lastUsedAt),
    ageDays,
    parentKeyId: stringOrNull(body.parentKeyId),
    isActive: true,
    raw: parsed,
  };
  return { ok: true, status };
}

/** Sugar — caller doesn't need to discriminate on `ok`. */
export async function isKeyValid(opts: {
  synapUrl: string;
  apiKey: string;
  runner?: IDoctorRunner;
}): Promise<boolean> {
  const r = await getAuthStatus(opts);
  return r.ok;
}

// ---------------------------------------------------------------------------
// renewAgentKey — call POST /api/hub/setup/agent and atomically swap secrets
// ---------------------------------------------------------------------------

export interface RenewAgentKeyOptions {
  /** Where `.eve/secrets/secrets.json` lives. Defaults to the @eve/dna default. */
  deployDir?: string;
  /** Free-form reason logged when the renew fires (e.g. "key_revoked during update"). */
  reason?: string;
  /** Override the runner — same abstraction the diagnostics use. */
  runner?: IDoctorRunner;
  /** Hard wall-clock cap on the mint call. Default 10s. */
  timeoutMs?: number;
}

export type RenewResult =
  | { renewed: true; apiKey: string; keyIdPrefix: string }
  | { renewed: false; reason: string };

const RENEW_TIMEOUT_MS = 10_000;

export async function renewAgentKey(opts: RenewAgentKeyOptions = {}): Promise<RenewResult> {
  const cwd = opts.deployDir ?? process.env.EVE_HOME ?? process.cwd();
  const secrets = await readEveSecrets(cwd);
  const synapUrl = secrets?.synap?.apiUrl?.trim();
  if (!synapUrl) {
    return {
      renewed: false,
      reason: "synap.apiUrl not set in secrets.json — run `eve install` first",
    };
  }

  // Bootstrap secret: env first, then synap deploy `.env` as a fallback.
  // PROVISIONING_TOKEN is a one-shot install-time secret; we don't currently
  // persist it in the Eve secrets file, so post-install renewal needs it
  // to be provided explicitly.
  const provisioningToken = resolveProvisioningToken();
  if (!provisioningToken) {
    return {
      renewed: false,
      reason:
        "PROVISIONING_TOKEN no longer available — re-run eve install or set EVE_PROVISIONING_TOKEN=...",
    };
  }

  const runner = opts.runner ?? new FetchRunner();
  const url = `${synapUrl.replace(/\/+$/, "")}/api/hub/setup/agent`;

  const previousPrefix = (secrets?.synap?.apiKey ?? "").slice(0, 8);
  const body = JSON.stringify({
    name: "eve-cli",
    // Hint the backend we're a renewal so it can attribute the new key
    // back to the previous one if it tracks parentKeyId.
    parentKeyIdPrefix: previousPrefix || undefined,
    reason: opts.reason ?? "renew",
  });
  const headers: Record<string, string> = {
    Authorization: `Bearer ${provisioningToken}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  const res = await runner.httpPost(url, headers, body, {
    timeoutMs: opts.timeoutMs ?? RENEW_TIMEOUT_MS,
  });

  if (res.status === 0) {
    return {
      renewed: false,
      reason: `Cannot reach ${url} (${res.error ?? "network error"})`,
    };
  }
  if (res.status === 401 || res.status === 403) {
    return {
      renewed: false,
      reason: `PROVISIONING_TOKEN rejected (${res.status}) — token expired or wrong, re-run eve install`,
    };
  }
  if (res.status === 404) {
    return {
      renewed: false,
      reason: "POST /api/hub/setup/agent not available — backend version too old (update synap)",
    };
  }
  if (res.status < 200 || res.status >= 300) {
    return {
      renewed: false,
      reason: `Backend returned ${res.status}: ${res.body.slice(0, 160)}`,
    };
  }

  const parsed = tryJson(res.body);
  if (!parsed || typeof parsed !== "object") {
    return {
      renewed: false,
      reason: "Mint response was not JSON",
    };
  }
  const obj = parsed as Record<string, unknown>;
  // Accept either `hubApiKey` (per spec) or `apiKey` (alternate name).
  const hubApiKey = stringOr(obj.hubApiKey, stringOr(obj.apiKey, ""));
  if (!hubApiKey) {
    return {
      renewed: false,
      reason: "Mint response did not include hubApiKey",
    };
  }
  const keyIdPrefix = stringOr(
    obj.keyIdPrefix,
    stringOr(obj.keyId, "").slice(0, 8) || hubApiKey.slice(0, 8),
  );

  // Atomic swap: rewrite secrets.json with the new apiKey, preserving every
  // other field. We bypass `writeEveSecrets` here because we need a write
  // path that survives a partial failure — readEveSecrets() returns the
  // schema-coerced shape and we only mutate `synap.apiKey`. The existing
  // helper merges nested objects, but writing through it doubles the risk
  // surface (parse the merged shape, re-parse). The minimum-viable approach
  // is to read-modify-write the JSON blob.
  try {
    await atomicReplaceApiKey(cwd, hubApiKey);
  } catch (err) {
    return {
      renewed: false,
      reason: `Mint succeeded but secrets.json write failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  return { renewed: true, apiKey: hubApiKey, keyIdPrefix };
}

/**
 * Pull the install-time PROVISIONING_TOKEN from any of the places the
 * install path may have left it:
 *   1. `EVE_PROVISIONING_TOKEN` env var (operator-supplied for renew)
 *   2. `PROVISIONING_TOKEN` env var (matches the docker-compose convention)
 *   3. `<SYNAP_DEPLOY_DIR>/.env` line `PROVISIONING_TOKEN=...`
 *
 * Returns the trimmed token or `null` when none is available. We never
 * throw on missing/unreadable .env — that's the dominant case post-install.
 */
function resolveProvisioningToken(): string | null {
  const envToken =
    process.env.EVE_PROVISIONING_TOKEN ?? process.env.PROVISIONING_TOKEN;
  if (envToken && envToken.trim().length > 0) return envToken.trim();

  const candidates = [
    process.env.SYNAP_DEPLOY_DIR,
    "/opt/synap-backend/deploy",
  ].filter((d): d is string => typeof d === "string" && d.length > 0);

  for (const dir of candidates) {
    const envPath = join(dir, ".env");
    if (!existsSync(envPath)) continue;
    try {
      const text = readFileSync(envPath, "utf-8");
      for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith("#")) continue;
        const eq = line.indexOf("=");
        if (eq < 0) continue;
        if (line.slice(0, eq).trim() === "PROVISIONING_TOKEN") {
          const value = line.slice(eq + 1).trim();
          if (value.length > 0) return value;
        }
      }
    } catch {
      // unreadable — skip
    }
  }
  return null;
}

/**
 * Atomic in-place rewrite of `synap.apiKey` in secrets.json.
 *
 * - Reads the existing JSON (if any) and mutates only the targeted field.
 * - Writes a sibling temp file with mode 0600, then `rename()` over the
 *   target. On crash mid-write the original file is untouched; on
 *   `rename()` failure the temp file is removed.
 * - When `secrets.json` doesn't exist yet, writes a minimal valid blob
 *   that satisfies `EveSecretsSchema` (version + updatedAt + synap.apiKey).
 */
async function atomicReplaceApiKey(cwd: string, newKey: string): Promise<void> {
  const path = secretsPath(cwd);
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });

  let parsed: Record<string, unknown> = {};
  if (existsSync(path)) {
    const raw = await readFile(path, "utf-8");
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      // File is corrupt — start over with a minimal shape rather than
      // silently rewriting a non-JSON file (which would hide the corruption
      // from the operator). We still preserve the broken file by writing
      // alongside, so a user can recover manually if needed.
      await writeFile(`${path}.broken-${Date.now()}`, raw, { mode: 0o600 });
      parsed = {};
    }
  }

  const synap = (parsed.synap as Record<string, unknown> | undefined) ?? {};
  synap.apiKey = newKey;
  parsed.synap = synap;
  parsed.version = "1";
  parsed.updatedAt = new Date().toISOString();

  const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
  await writeFile(tmp, JSON.stringify(parsed, null, 2), { mode: 0o600 });
  try {
    await rename(tmp, path);
  } catch (err) {
    // Best-effort cleanup of the temp file if rename failed.
    try {
      const { unlink } = await import("node:fs/promises");
      await unlink(tmp);
    } catch {
      // ignore
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// 401 envelope parsing
// ---------------------------------------------------------------------------

const STRUCTURED_REASONS: ReadonlySet<AuthFailReason> = new Set([
  "key_revoked",
  "missing_scope",
  "expired",
  "invalid_format",
  "no_auth",
]);

function parse401(httpStatus: number, body: string): AuthResult {
  const parsed = tryJson(body);
  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    const reasonStr = stringOr(obj.reason, "");
    if (reasonStr && STRUCTURED_REASONS.has(reasonStr as AuthFailReason)) {
      return {
        ok: false,
        failure: {
          reason: reasonStr as AuthFailReason,
          httpStatus,
          message: stringOr(obj.message, `unauthorized (${reasonStr})`),
          missingScope: stringOr(obj.missingScope, "") || undefined,
          keyIdPrefix: stringOr(obj.keyIdPrefix, "") || undefined,
          raw: parsed,
        },
      };
    }
  }
  // Older backend with no envelope — treat as a revoked key. The CLI's
  // fix hint ("eve auth renew") still does the right thing here.
  return {
    ok: false,
    failure: {
      reason: "key_revoked",
      httpStatus,
      message: `unauthorized (${httpStatus}) — backend did not return a structured envelope`,
      raw: parsed ?? body,
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stringOr<T extends string>(v: unknown, fallback: T): string {
  return typeof v === "string" ? v : fallback;
}

function stringOrNull(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function stringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

function tryJson(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function computeAgeDays(createdAt: string): number {
  const t = Date.parse(createdAt);
  if (Number.isNaN(t)) return 0;
  const ms = Date.now() - t;
  if (ms <= 0) return 0;
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}
