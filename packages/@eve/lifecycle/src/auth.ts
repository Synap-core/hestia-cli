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
 * synap-backend has no host port mapping (DockerExecRunner — picked by
 * `buildPodRunner` based on whether the synap container is local).
 *
 * No new top-level dependencies. Built-in fetch via the runner;
 * `node:fs/promises` for atomic file writes; nothing else.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { writeEnvVar } from "./env-files.js";
import {
  LEGACY_CODER_ENGINE_SLUGS,
  POD_DEPLOY_DIR_CANDIDATES,
  SYNAP_BACKEND_CONTAINERS,
  agentsToProvision,
  findPodDeployDir,
  readAgentKey,
  readEveSecrets,
  resolveSynapUrlOnHost,
  restartBackendContainer,
  writeAgentKey,
  writeCodeEngine,
  writeEveSecrets,
  type AgentInfo,
  type AgentKeyRecord,
  type CodeEngine,
  type EveSecrets,
} from "@eve/dna";
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
  /**
   * Which agent slug to renew. Defaults to `"eve"` — the one used by
   * Doctor and any back-compat reader of `secrets.synap.apiKey`. Pass
   * an explicit slug (e.g. "openclaw") to renew a specific consumer.
   */
  agentType?: string;
  /** Free-form reason logged when the renew fires (e.g. "key_revoked during update"). */
  reason?: string;
  /** Override the runner — same abstraction the diagnostics use. */
  runner?: IDoctorRunner;
  /** Hard wall-clock cap on the mint call. Default 10s. */
  timeoutMs?: number;
}

export type RenewResult =
  | { renewed: true; apiKey: string; keyIdPrefix: string; agentType: string }
  | { renewed: false; reason: string; agentType: string };

const RENEW_TIMEOUT_MS = 10_000;

/**
 * Re-mint one agent's Hub Protocol key.
 *
 * Thin wrapper over `provisionAgent` for the renew use case — same
 * code path, but the public name signals intent (you're rotating an
 * existing key, not minting one for a brand-new agent). Idempotent:
 * the pod's `/setup/agent` reuses the agent user and revokes the old
 * key, so calling renew on an unprovisioned agent works the same as
 * the first install-time mint.
 */
export async function renewAgentKey(opts: RenewAgentKeyOptions = {}): Promise<RenewResult> {
  const agentType = opts.agentType ?? "eve";
  const result = await provisionAgent({
    agentType,
    deployDir: opts.deployDir,
    reason: opts.reason ?? "renew",
    runner: opts.runner,
    timeoutMs: opts.timeoutMs,
  });
  if (result.provisioned) {
    return {
      renewed: true,
      apiKey: result.record.hubApiKey,
      keyIdPrefix: result.keyIdPrefix,
      agentType,
    };
  }
  return { renewed: false, reason: result.reason, agentType };
}

// ---------------------------------------------------------------------------
// provisionAgent — the canonical agent-key mint path. Used by install,
// renew, and the legacy-key migration. Wraps the /setup/agent contract
// in one place so every caller benefits from the same error envelope,
// timeout policy, and atomic write path.
// ---------------------------------------------------------------------------

export interface ProvisionAgentOptions {
  /** Required — the agentType slug to mint a key for. */
  agentType: string;
  /** Where `.eve/secrets/secrets.json` lives. Defaults to EVE_HOME / cwd. */
  deployDir?: string;
  /** Free-form reason ("install", "renew", "migrate") — logged on the wire. */
  reason?: string;
  /** Override the runner. Defaults to FetchRunner (same abstraction as diagnostics). */
  runner?: IDoctorRunner;
  /** Hard wall-clock cap on the mint call. Default 10s. */
  timeoutMs?: number;
  /**
   * Override the synap pod URL. When unset we derive it via
   * `resolveSynapUrlOnHost(secrets)` — prefers the loopback port
   * published by Eve's compose override when reachable, falls back to
   * the public Traefik URL otherwise. Useful for tests and one-shot
   * CLI flows that target a non-default pod.
   */
  synapUrl?: string;
  /**
   * Override PROVISIONING_TOKEN. When unset we resolve it from env
   * (EVE_PROVISIONING_TOKEN, then PROVISIONING_TOKEN) and finally
   * the synap deploy `.env` file. Tests pass it directly.
   */
  provisioningToken?: string;
}

export type ProvisionResult =
  | {
      provisioned: true;
      agentType: string;
      record: AgentKeyRecord;
      /** First 8 chars of the keyId (or apiKey if backend doesn't return one). */
      keyIdPrefix: string;
    }
  | {
      provisioned: false;
      agentType: string;
      reason: string;
    };

/**
 * Mint one agent's Hub Protocol key via `POST /api/hub/setup/agent`.
 *
 * Authoritative flow — every install / renew / migrate path goes
 * through here:
 *
 *   1. Resolve pod URL (option > resolveSynapUrlOnHost(secrets)).
 *   2. Resolve PROVISIONING_TOKEN (option > env > deploy/.env).
 *   3. POST /setup/agent with `{ agentType }`.
 *   4. Persist the returned `{ hubApiKey, agentUserId, workspaceId }`
 *      under `secrets.agents[agentType]`.
 *   5. When `agentType === "eve"`, mirror the key into the legacy
 *      `secrets.synap.apiKey` field (handled in `writeAgentKey`) so
 *      back-compat readers keep working through one release.
 *
 * Never throws. Every error mode (no URL, no token, network, 401, 5xx,
 * malformed body, write failure) becomes a `{ provisioned: false }`
 * result with a human-readable `reason`.
 */
export async function provisionAgent(opts: ProvisionAgentOptions): Promise<ProvisionResult> {
  const agentType = opts.agentType;
  if (!agentType || agentType.trim().length === 0) {
    return { provisioned: false, agentType: "", reason: "agentType is required" };
  }

  const cwd = opts.deployDir ?? process.env.EVE_HOME ?? process.cwd();
  const secrets = await readEveSecrets(cwd);
  // On-host: prefer Eve's loopback port (sub-ms, no DNS, no cert).
  // Off-host: falls back to the public Traefik URL via `domain.primary`.
  // The caller can still force a specific URL via `opts.synapUrl`.
  const synapUrl = (opts.synapUrl ?? (await resolveSynapUrlOnHost(secrets))).trim();
  if (!synapUrl) {
    const hasSecrets = !!secrets;
    return {
      provisioned: false,
      agentType,
      reason: hasSecrets
        ? "synap pod URL unresolved — set domain.primary or synap.apiUrl in ~/.eve/secrets.json"
        : "~/.eve/secrets.json not found — run `eve setup` first to initialise Eve on this server",
    };
  }

  let tokenLookup: TokenLookup = opts.provisioningToken
    ? { token: opts.provisioningToken, source: "explicit", diagnosticReason: "" }
    : resolveProvisioningTokenWithDiagnostics();

  // Self-heal: if no token is reachable (or the placeholder is empty),
  // mint one and write it into the pod's deploy/.env, then restart the
  // backend so it accepts the new value. This is what an operator would
  // do manually — no reason Eve can't do it automatically.
  //
  // We only attempt this when the caller didn't pass an explicit token.
  // If they passed one and it's bad, that's a different problem (the
  // backend will reject it with a 401 envelope downstream).
  if (!tokenLookup.token && !opts.provisioningToken) {
    try {
      const ensured = await ensurePodProvisioningToken();
      tokenLookup = {
        token: ensured.token,
        source: ensured.source === "generated" ? "file" : "file",
        diagnosticReason: "",
      };
      // If we just generated a token, the backend container needs a moment
      // to accept it. `docker compose up -d backend` returns once the
      // container is started but the HTTP listener may not be bound yet.
      // Poll briefly so the very next /api/hub/setup/agent call doesn't
      // race the boot.
      if (ensured.source === "generated" && ensured.backendRestarted) {
        await waitForBackend(synapUrl, opts.runner ?? new FetchRunner());
      }
    } catch (err) {
      return {
        provisioned: false,
        agentType,
        reason:
          tokenLookup.diagnosticReason ||
          `Could not auto-generate PROVISIONING_TOKEN: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  if (!tokenLookup.token) {
    return {
      provisioned: false,
      agentType,
      reason: tokenLookup.diagnosticReason,
    };
  }
  const provisioningToken = tokenLookup.token;

  const runner = opts.runner ?? new FetchRunner();
  const url = `${synapUrl.replace(/\/+$/, "")}/api/hub/setup/agent`;
  const previousPrefix = (secrets?.agents?.[agentType]?.hubApiKey ?? secrets?.synap?.apiKey ?? "").slice(0, 8);

  const body = JSON.stringify({
    agentType,
    // Diagnostic hints — backend ignores unknown fields. Useful in pod
    // logs to attribute key churn ("renew", "migrate", "install") and
    // to chain new keys back to the previous one if the backend tracks
    // parentKeyId.
    name: `eve-${agentType}`,
    parentKeyIdPrefix: previousPrefix || undefined,
    reason: opts.reason ?? "provision",
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
      provisioned: false,
      agentType,
      reason: `Cannot reach ${url} (${res.error ?? "network error"})`,
    };
  }
  if (res.status === 202) {
    // ISSUER_PENDING_APPROVAL — only fires when /setup/agent rejects the
    // PROVISIONING_TOKEN as a JWT and falls into the trusted-issuers
    // pending flow. In practice this means the token was malformed or
    // the operator pasted a CP JWT here by mistake. Surface the reason
    // verbatim so they can route to the admin panel if needed.
    const parsed = tryJson(res.body);
    const adminUrl =
      typeof parsed === "object" && parsed && typeof (parsed as Record<string, unknown>).adminUrl === "string"
        ? (parsed as Record<string, unknown>).adminUrl
        : null;
    return {
      provisioned: false,
      agentType,
      reason: `Backend deferred the request (issuer pending approval). Visit ${adminUrl ?? `${synapUrl}/admin/trusted-issuers`} to approve, then retry.`,
    };
  }
  if (res.status === 401 || res.status === 403) {
    return {
      provisioned: false,
      agentType,
      reason: `PROVISIONING_TOKEN rejected (${res.status}) — token expired, wrong, or backend doesn't accept it. Re-check deploy/.env or run \`eve install\`.`,
    };
  }
  if (res.status === 404) {
    return {
      provisioned: false,
      agentType,
      reason:
        `POST ${url} returned 404. ` +
        "Either the backend image is outdated (run `eve update synap`) or " +
        "Traefik is returning 404 because the loopback port isn't bound. " +
        "Check: `ss -tlnp | grep 4000` on the pod host, then `eve doctor`.",
    };
  }
  if (res.status < 200 || res.status >= 300) {
    return {
      provisioned: false,
      agentType,
      reason: `Backend returned ${res.status}: ${res.body.slice(0, 160)}`,
    };
  }

  const parsed = tryJson(res.body);
  if (!parsed || typeof parsed !== "object") {
    return {
      provisioned: false,
      agentType,
      reason: "Mint response was not JSON",
    };
  }
  const obj = parsed as Record<string, unknown>;
  const hubApiKey = stringOr(obj.hubApiKey, stringOr(obj.apiKey, ""));
  if (!hubApiKey) {
    return {
      provisioned: false,
      agentType,
      reason: "Mint response did not include hubApiKey",
    };
  }
  const agentUserId = stringOr(obj.agentUserId, "");
  const workspaceId = stringOr(obj.workspaceId, "");
  const keyId = stringOr(obj.keyId, "");
  const keyIdPrefix = stringOr(
    obj.keyIdPrefix,
    keyId.slice(0, 8) || hubApiKey.slice(0, 8),
  );

  if (!agentUserId || !workspaceId) {
    return {
      provisioned: false,
      agentType,
      reason: "Mint response missing required fields (agentUserId/workspaceId)",
    };
  }

  const record: AgentKeyRecord = {
    hubApiKey,
    agentUserId,
    workspaceId,
    keyId: keyId || undefined,
    createdAt: new Date().toISOString(),
  };

  try {
    await writeAgentKey(agentType, record, cwd);
  } catch (err) {
    return {
      provisioned: false,
      agentType,
      reason: `Mint succeeded but secrets.json write failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  return { provisioned: true, agentType, record, keyIdPrefix };
}

/**
 * Provision every agent in the registry whose backing component is
 * installed (plus the always-on "eve" agent).
 *
 * Used by the lifecycle layer at the end of an `eve install` run to
 * make sure every consumer has its own key, not the legacy shared one.
 *
 * Failures are partial — one agent failing to mint doesn't block the
 * others. Returns the per-agent results so the caller can render a
 * summary table.
 */
export async function provisionAllAgents(opts: {
  installedComponentIds: readonly string[];
  deployDir?: string;
  reason?: string;
  runner?: IDoctorRunner;
  /** Pre-resolved pod URL — pass the value from runBackendPreflight to avoid re-resolving. */
  synapUrl?: string;
  /** Pre-resolved PROVISIONING_TOKEN — pass the value from runBackendPreflight. */
  provisioningToken?: string;
  /** Skip an agent if its key already exists. Defaults to true. */
  skipIfPresent?: boolean;
}): Promise<ProvisionResult[]> {
  const cwd = opts.deployDir ?? process.env.EVE_HOME ?? process.cwd();
  const skipIfPresent = opts.skipIfPresent ?? true;
  const agents: AgentInfo[] = agentsToProvision(opts.installedComponentIds);
  const results: ProvisionResult[] = [];

  for (const agent of agents) {
    if (skipIfPresent) {
      const existing = await readAgentKey(agent.agentType, cwd);
      if (existing && existing.hubApiKey) {
        results.push({
          provisioned: true,
          agentType: agent.agentType,
          record: existing,
          keyIdPrefix: (existing.keyId ?? existing.hubApiKey).slice(0, 8),
        });
        continue;
      }
    }
    const result = await provisionAgent({
      agentType: agent.agentType,
      deployDir: cwd,
      reason: opts.reason ?? "provision-all",
      runner: opts.runner,
      synapUrl: opts.synapUrl,
      provisioningToken: opts.provisioningToken,
    });
    results.push(result);
  }

  return results;
}

/**
 * Migrate a legacy install to the current per-agent layout.
 *
 * Two distinct legacy shapes are handled:
 *
 *  1. Single-key world: only `secrets.synap.apiKey` is set. Mint a fresh
 *     key for every registered agent (including eve), which atomically
 *     replaces the legacy blob. The legacy field stays populated as the
 *     eve agent's key alias (mirrored by `writeAgentKey`).
 *
 *  2. Three-coder-agents world: `secrets.agents.claudecode` and/or
 *     `secrets.agents.opencode` and/or `secrets.agents.openclaude` exist
 *     from a pre-consolidation install. We collapse those into a single
 *     `coder` agent + a `secrets.builder.codeEngine` config field. The
 *     old per-engine entries are stripped from `secrets.agents` so
 *     downstream readers can't accidentally reach for them. (The
 *     corresponding agent users / keys remain on the pod; operators can
 *     clean them up via the dashboard. There is no Hub Protocol bulk
 *     revoke endpoint to call here — the existing `/setup/agent` path
 *     only revokes when re-minting under the SAME slug, and we're moving
 *     to a different slug.)
 *
 * Why mint fresh keys instead of reusing the legacy one: the legacy
 * key was minted with `agentType: "openclaw"` (the only slug install
 * ever supported). It can't legitimately represent eve / hermes /
 * pipelines on the pod side — those agents need their own audit trail.
 * Re-minting under the right slug is the only correct path.
 *
 * Idempotent on both axes: re-running after a successful migration is
 * a no-op once the eve agent key is present and there are no legacy
 * coder slugs left.
 */
export async function migrateLegacyToAgents(opts: {
  installedComponentIds: readonly string[];
  deployDir?: string;
  runner?: IDoctorRunner;
}): Promise<{
  migrated: boolean;
  results: ProvisionResult[];
  reason?: string;
  /** Engine picked from legacy per-engine keys, when that path triggered. */
  collapsedToEngine?: CodeEngine;
  /** Legacy slugs that were stripped from secrets.agents during migration. */
  strippedLegacySlugs?: string[];
}> {
  const cwd = opts.deployDir ?? process.env.EVE_HOME ?? process.cwd();
  const secretsBefore = await readEveSecrets(cwd);

  // ---- Phase A: collapse legacy per-engine coder agents (if any) ------
  const collapse = await collapseLegacyCoderAgents(secretsBefore, cwd);

  // ---- Phase B: per-agent migration (single-key → registry) -----------
  const eveExisting = await readAgentKey("eve", cwd);
  const needsPerAgent = !eveExisting || !eveExisting.hubApiKey;

  if (!needsPerAgent && !collapse.collapsed) {
    return {
      migrated: false,
      results: [],
      reason: "already migrated — eve agent key present and no legacy coder slugs",
    };
  }

  // Same flow as provisionAllAgents but with skipIfPresent=false when we
  // need to mint the eve agent. When ONLY the coder collapse fired (eve
  // already present), we still call provisionAllAgents but with
  // skipIfPresent=true so we don't churn already-good keys — the only
  // new mint should be the `coder` slot.
  const results = await provisionAllAgents({
    installedComponentIds: opts.installedComponentIds,
    deployDir: cwd,
    reason: collapse.collapsed ? "migrate-legacy-coder-collapse" : "migrate-legacy",
    runner: opts.runner,
    skipIfPresent: !needsPerAgent,
  });
  const anyOk = results.some((r) => r.provisioned);
  return {
    migrated: anyOk || collapse.collapsed,
    results,
    reason: anyOk
      ? undefined
      : collapse.collapsed
        ? "coder collapse applied; new agent provisioning failed — see per-agent reasons"
        : "no agent could be provisioned — see per-agent reasons",
    collapsedToEngine: collapse.engine,
    strippedLegacySlugs: collapse.stripped,
  };
}

/**
 * Detect and rewrite legacy per-engine coder agent slots.
 *
 * Legacy installs may have minted separate Hub keys under
 * `secrets.agents.{claudecode, opencode, openclaude}`. The new model
 * collapses those into ONE `coder` Hub identity plus a
 * `secrets.builder.codeEngine` config field that picks the local CLI.
 *
 * Strategy:
 *   1. Find which legacy slugs are present in secrets.agents.
 *   2. If `secrets.builder.codeEngine` is unset, pick one from the
 *      legacy slugs — preferring claudecode > opencode > openclaude.
 *   3. Strip the legacy entries from `secrets.agents` (keep workspace,
 *      agent, etc. — only delete the three per-engine records).
 *   4. Persist `secrets.builder.codeEngine`.
 *
 * Returns `collapsed: false` when there's nothing to do.
 */
async function collapseLegacyCoderAgents(
  secrets: EveSecrets | null,
  cwd: string,
): Promise<{ collapsed: boolean; engine?: CodeEngine; stripped: string[] }> {
  if (!secrets) return { collapsed: false, stripped: [] };
  const agents = secrets.agents ?? {};

  const presentLegacy: CodeEngine[] = LEGACY_CODER_ENGINE_SLUGS.filter(
    (slug) => agents[slug] !== undefined,
  );
  if (presentLegacy.length === 0) {
    return { collapsed: false, stripped: [] };
  }

  // Pick winning engine: existing config wins; otherwise prefer claudecode,
  // then opencode, then openclaude (matching LEGACY_CODER_ENGINE_SLUGS order).
  const existingChoice = secrets.builder?.codeEngine;
  const pickedEngine: CodeEngine =
    existingChoice && LEGACY_CODER_ENGINE_SLUGS.includes(existingChoice)
      ? existingChoice
      : presentLegacy[0];

  // Persist engine choice.
  await writeCodeEngine(pickedEngine, cwd);

  // Strip legacy slots from secrets.agents.
  const nextAgents: Record<string, AgentKeyRecord> = {};
  for (const [slug, rec] of Object.entries(agents)) {
    if ((LEGACY_CODER_ENGINE_SLUGS as readonly string[]).includes(slug)) continue;
    nextAgents[slug] = rec as AgentKeyRecord;
  }
  await writeEveSecrets({ agents: nextAgents }, cwd);

  return { collapsed: true, engine: pickedEngine, stripped: presentLegacy };
}

/**
 * Pull the install-time PROVISIONING_TOKEN from any of the places the
 * install path may have left it. Order matters — first hit wins:
 *   1. `EVE_PROVISIONING_TOKEN` env var (operator-supplied)
 *   2. `PROVISIONING_TOKEN` env var (matches docker-compose convention)
 *   3. `<SYNAP_DEPLOY_DIR>/.env` line `PROVISIONING_TOKEN=...`
 *   4. Common pod install paths' `.env` (synap-backend / synap / synap-pod)
 *   5. `docker inspect` on the running synap-backend container — the most
 *      robust path because it works regardless of where the pod was
 *      installed, as long as the container is alive (which it must be
 *      for any provisioning call to succeed anyway).
 *
 * Returns the trimmed token or `null` when none is available. We never
 * throw on missing/unreadable sources — caller surfaces the friendly hint.
 */
interface TokenLookup {
  token: string | null;
  /** Where we found (or didn't find) the token. */
  source: "env" | "file" | "docker" | "explicit" | "missing" | "empty";
  /** Friendlier-than-default reason string, with a concrete remedy. */
  diagnosticReason: string;
}

/**
 * Public adapter — keeps the boolean shape some callers depend on.
 */
function resolveProvisioningToken(): string | null {
  return resolveProvisioningTokenWithDiagnostics().token;
}

/**
 * Poll `${synapUrl}/api/hub/health` until it returns OK or we hit the
 * timeout. Used after auto-generating a PROVISIONING_TOKEN to give the
 * recreated backend container a moment to bind its HTTP listener before
 * we hammer it with `/api/hub/setup/agent` calls.
 *
 * Quiet on every failure — the worst case is we proceed eagerly and the
 * caller surfaces a transport error, which they would have anyway.
 */
async function waitForBackend(
  synapUrl: string,
  runner: IDoctorRunner,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const intervalMs = opts.intervalMs ?? 500;
  const url = `${synapUrl.replace(/\/+$/, "")}/api/hub/health`;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await runner.httpGet(url, {}, { timeoutMs: 1500 });
      if (res.status >= 200 && res.status < 500) return;
    } catch {
      // transport error — backend still binding
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

// ---------------------------------------------------------------------------
// Self-healing — auto-generate PROVISIONING_TOKEN when missing/empty
// ---------------------------------------------------------------------------

// POD_DEPLOY_DIR_CANDIDATES, findPodDeployDir — imported from @eve/dna/docker-helpers

export interface EnsureProvisioningTokenResult {
  token: string;
  /** "existing": pod already had a non-empty token. "generated": we minted
   *  a new one and wrote it back to the pod's .env (and tried to restart
   *  the backend container so it picks it up). */
  source: "existing" | "generated";
  /** When `generated`, the .env path we wrote to (for log lines). */
  writtenTo?: string;
  /** True iff we successfully restarted the backend after writing. */
  backendRestarted?: boolean;
}

/**
 * Ensure the pod has a working PROVISIONING_TOKEN. Idempotent:
 *   - If a non-empty token is already reachable (env var, deploy/.env,
 *     running container), return it as-is.
 *   - Otherwise, generate a fresh 64-char hex token, write it into the
 *     pod's deploy/.env (creates the line if absent, replaces the empty
 *     placeholder if present), and attempt `docker compose up -d backend`
 *     so the backend reloads the env. Falls back to `docker restart` if
 *     compose isn't usable.
 *
 * Throws only if no pod deploy dir is reachable (we don't know where to
 * write). Restart failures are non-fatal — the token is still on disk and
 * the next backend restart will pick it up.
 */
export async function ensurePodProvisioningToken(): Promise<EnsureProvisioningTokenResult> {
  const probe = resolveProvisioningTokenWithDiagnostics();
  if (probe.token) {
    return { token: probe.token, source: "existing" };
  }

  const deployDir = findPodDeployDir();
  if (!deployDir) {
    throw new Error(
      "No pod deploy directory found — set SYNAP_DEPLOY_DIR or install synap-backend first " +
        "(checked: " +
        POD_DEPLOY_DIR_CANDIDATES.join(", ") +
        ").",
    );
  }

  const token = randomBytes(32).toString("hex");
  const result = writeEnvVar(deployDir, "PROVISIONING_TOKEN", token);
  const envFilePath = join(deployDir, ".env");

  // Best-effort restart so the running backend reloads its env.
  // Non-fatal: the token is on disk; the next manual restart picks it up.
  const backendRestarted = restartBackendContainer(deployDir);
  void result; // WriteEnvVarResult.changed logged by caller if needed

  return {
    token,
    source: "generated",
    writtenTo: envFilePath,
    backendRestarted,
  };
}

/**
 * Same lookup as `resolveProvisioningToken`, but also reports WHY we
 * failed (so callers can surface the actionable remedy):
 *   - `missing`: nothing on disk or in the running pod's env at all.
 *   - `empty`: found a placeholder line `PROVISIONING_TOKEN=` (typically
 *     from copying `.env.example` without filling it in). This is the
 *     SILENT footgun — the pod boots fine, but `/api/hub/setup/agent`
 *     can never authenticate because the secret is the empty string.
 */
function resolveProvisioningTokenWithDiagnostics(): TokenLookup {
  // 1. Env vars — operator override.
  const envName = process.env.EVE_PROVISIONING_TOKEN !== undefined
    ? "EVE_PROVISIONING_TOKEN"
    : process.env.PROVISIONING_TOKEN !== undefined
      ? "PROVISIONING_TOKEN"
      : null;
  const envValue =
    process.env.EVE_PROVISIONING_TOKEN ?? process.env.PROVISIONING_TOKEN;
  if (envName !== null && (envValue ?? "").trim().length === 0) {
    return {
      token: null,
      source: "empty",
      diagnosticReason: `${envName} is set but empty. Either unset it (so we can fall back to the pod's deploy/.env) or assign a real value (\`openssl rand -hex 32\`).`,
    };
  }
  if (envValue && envValue.trim().length > 0) {
    return { token: envValue.trim(), source: "env", diagnosticReason: "" };
  }

  // 2. Pod's deploy/.env — common install paths.
  const dirCandidates = [
    process.env.SYNAP_DEPLOY_DIR,
    "/opt/synap-backend/deploy",
    "/opt/synap-backend",
    "/opt/synap/deploy",
    "/opt/synap",
    "/opt/synap-pod/deploy",
    "/opt/synap-pod",
    "/srv/synap-backend/deploy",
    "/srv/synap/deploy",
  ].filter((d): d is string => typeof d === "string" && d.length > 0);

  let fileFoundEmpty = false;
  let fileFoundEmptyAt = "";
  for (const dir of dirCandidates) {
    const envPath = join(dir, ".env");
    if (!existsSync(envPath)) continue;
    const probe = readEnvFileVarWithStatus(envPath, "PROVISIONING_TOKEN");
    if (probe.value) {
      return { token: probe.value, source: "file", diagnosticReason: "" };
    }
    if (probe.status === "found-empty" && !fileFoundEmpty) {
      fileFoundEmpty = true;
      fileFoundEmptyAt = envPath;
    }
  }

  // 3. Running container's env — works when files aren't readable.
  const dockerProbe = readProvisioningTokenFromDockerWithStatus();
  if (dockerProbe.value) {
    return { token: dockerProbe.value, source: "docker", diagnosticReason: "" };
  }

  // 4. No token anywhere — emit the most actionable diagnostic we can.
  if (fileFoundEmpty || dockerProbe.status === "found-empty") {
    const where = fileFoundEmpty
      ? fileFoundEmptyAt
      : "the running synap-backend container's env";
    return {
      token: null,
      source: "empty",
      diagnosticReason:
        `PROVISIONING_TOKEN is empty in ${where}. The pod was deployed without filling it in. ` +
        `Fix: \`openssl rand -hex 32\` and write the value into the pod's deploy/.env, then ` +
        `\`docker compose up -d backend\` (or \`docker restart synap-backend-backend-1\`) and retry. ` +
        `See \`eve auth bootstrap-token\` for an automated path once supported.`,
    };
  }

  return {
    token: null,
    source: "missing",
    diagnosticReason:
      "PROVISIONING_TOKEN unavailable. Set EVE_PROVISIONING_TOKEN, or ensure the pod's deploy/.env is readable. " +
      "PROVISIONING_TOKEN was generated when synap-backend was first installed and lives in deploy/.env on the pod host.",
  };
}

function readEnvFileVar(envPath: string, key: string): string | null {
  return readEnvFileVarWithStatus(envPath, key).value;
}

interface EnvProbe {
  value: string | null;
  /** "found": present + non-empty. "found-empty": placeholder line with empty
   *  value (operator copied .env.example without filling in). "absent":
   *  no line for that key, or file unreadable. */
  status: "found" | "found-empty" | "absent";
}

function readEnvFileVarWithStatus(envPath: string, key: string): EnvProbe {
  try {
    const text = readFileSync(envPath, "utf-8");
    let sawEmpty = false;
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq < 0) continue;
      if (line.slice(0, eq).trim() === key) {
        const value = line.slice(eq + 1).trim();
        if (value.length > 0) return { value, status: "found" };
        sawEmpty = true;
      }
    }
    return { value: null, status: sawEmpty ? "found-empty" : "absent" };
  } catch {
    return { value: null, status: "absent" };
  }
}

// SYNAP_BACKEND_CONTAINERS — imported from @eve/dna/docker-helpers

function readProvisioningTokenFromDocker(): string | null {
  return readProvisioningTokenFromDockerWithStatus().value;
}

function readProvisioningTokenFromDockerWithStatus(): EnvProbe {
  let sawEmpty = false;
  for (const container of SYNAP_BACKEND_CONTAINERS) {
    try {
      const out = execSync(
        `docker inspect --format='{{range .Config.Env}}{{println .}}{{end}}' ${container}`,
        { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"], timeout: 4000 },
      );
      for (const raw of out.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line) continue;
        const eq = line.indexOf("=");
        if (eq < 0) continue;
        if (line.slice(0, eq) === "PROVISIONING_TOKEN") {
          const value = line.slice(eq + 1).trim();
          if (value.length > 0) return { value, status: "found" };
          sawEmpty = true;
        }
      }
    } catch {
      // container missing, docker not on PATH, no permission — try next
    }
  }
  return { value: null, status: sawEmpty ? "found-empty" : "absent" };
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

// ---------------------------------------------------------------------------
// First-admin setup helpers
// ---------------------------------------------------------------------------

export interface FirstAdminOptions {
  synapUrl: string;
  provisioningToken: string;
  mode: "prompt" | "magic-link";
  /** For prompt mode — must be non-empty */
  email?: string;
  password?: string;
  name?: string;
}

/**
 * Check whether the pod still needs a first admin.
 *
 * Returns true when needsSetup === true in the backend response.
 *
 * Two-attempt strategy:
 *   1. Unauthenticated GET /api/hub/setup/status — the endpoint should be
 *      public, but some backend versions require auth.
 *   2. If 401/403, retry with the PROVISIONING_TOKEN as Bearer — the
 *      bootstrap token is always available and the setup endpoint accepts it.
 *
 * Defaults to true on transport errors (backend not up) so callers prompt
 * for admin setup rather than silently skipping it. Defaults to false on
 * other non-200 status codes (endpoint missing → older backend without the
 * setup flow).
 */
export async function checkNeedsAdmin(
  synapUrl: string,
  provisioningToken?: string,
): Promise<boolean> {
  const url = `${synapUrl.replace(/\/+$/, "")}/api/hub/setup/status`;
  const runner = new FetchRunner();

  const attempt = async (headers: Record<string, string>): Promise<boolean | null> => {
    try {
      const res = await runner.httpGet(url, { Accept: "application/json", ...headers }, { timeoutMs: 6_000 });
      if (res.status === 404) return false; // endpoint absent — older backend
      if (res.status === 401 || res.status === 403) return null; // needs different auth
      if (res.status < 200 || res.status >= 300) return false;
      const parsed = tryJson(res.body);
      if (!parsed || typeof parsed !== "object") return false;
      const obj = parsed as Record<string, unknown>;
      return obj.needsSetup === true;
    } catch {
      return true; // transport error — backend not ready, assume setup needed
    }
  };

  // 1. Try unauthenticated first
  const first = await attempt({});
  if (first !== null) return first;

  // 2. Endpoint required auth — retry with provisioning token
  if (provisioningToken) {
    const second = await attempt({ Authorization: `Bearer ${provisioningToken}` });
    if (second !== null) return second;
  }

  // 3. Auth required but no token available — assume needs setup to be safe
  return true;
}

/**
 * Create the first admin on the pod.
 *
 * - "prompt" mode: POST /api/hub/setup/first-admin directly with email + password.
 * - "magic-link" mode:
 *   1. POST /api/hub/setup/magic-link → get { token, url }
 *   2. Print the URL (caller should display it to the user)
 *   3. Poll GET /api/hub/setup/status every 3 s for up to 5 minutes
 *   4. When hasAdmin becomes true, resolve.
 *
 * Returns { userId, workspaceId } on success, or null on failure.
 * For magic-link mode, userId/workspaceId are empty strings (unknown
 * at poll time — caller resolves them from provision).
 */
export async function createFirstAdmin(
  opts: FirstAdminOptions
): Promise<{ userId: string; workspaceId: string } | null> {
  const base = opts.synapUrl.replace(/\/+$/, "");
  const runner = new FetchRunner();

  if (opts.mode === "prompt") {
    const email = opts.email?.trim() ?? "";
    const password = opts.password ?? "";
    if (!email || !password) return null;

    const body = JSON.stringify({
      email,
      password,
      name: opts.name?.trim() || undefined,
    });
    const res = await runner.httpPost(
      `${base}/api/hub/setup/first-admin`,
      {
        Authorization: `Bearer ${opts.provisioningToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body,
      { timeoutMs: 15_000 }
    );

    if (res.status < 200 || res.status >= 300) return null;
    const parsed = tryJson(res.body);
    if (!parsed || typeof parsed !== "object") return null;
    const obj = parsed as Record<string, unknown>;
    return {
      userId: stringOr(obj.userId, ""),
      workspaceId: stringOr(obj.workspaceId, ""),
    };
  }

  // magic-link mode
  const mlRes = await runner.httpPost(
    `${base}/api/hub/setup/magic-link`,
    {
      Authorization: `Bearer ${opts.provisioningToken}`,
      Accept: "application/json",
    },
    "",
    { timeoutMs: 10_000 }
  );

  if (mlRes.status < 200 || mlRes.status >= 300) return null;
  const mlParsed = tryJson(mlRes.body);
  if (!mlParsed || typeof mlParsed !== "object") return null;
  const mlObj = mlParsed as Record<string, unknown>;
  const setupUrl = stringOr(mlObj.url, "");

  // Caller uses the URL — we expose it via a callback or just return it.
  // We print it here since this is the lifecycle layer.
  if (setupUrl) {
    console.log();
    console.log(`  Setup URL: ${setupUrl}`);
    console.log(`  Open this link in your browser to create the first admin account.`);
    console.log(`  The link expires in 1 hour.`);
    console.log();
  }

  // Poll for up to 5 minutes
  const deadline = Date.now() + 5 * 60 * 1_000;
  const pollInterval = 3_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollInterval));
    const needs = await checkNeedsAdmin(opts.synapUrl, opts.provisioningToken);
    // needs === false means admin now exists (hasAdmin = true)
    if (!needs) {
      return { userId: "", workspaceId: "" };
    }
  }

  // Timeout — user never completed
  return null;
}
