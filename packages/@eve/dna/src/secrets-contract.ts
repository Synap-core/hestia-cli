import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { exportJWK, generateKeyPair } from 'jose';
import { z } from 'zod';

const AiProviderSchema = z.enum(['ollama', 'openrouter', 'anthropic', 'openai']);
const AiModeSchema = z.enum(['local', 'provider', 'hybrid']);

const SecretsSchema = z.object({
  version: z.literal('1'),
  updatedAt: z.string(),
  ai: z
    .object({
      mode: AiModeSchema.optional(),
      defaultProvider: AiProviderSchema.optional(),
      fallbackProvider: AiProviderSchema.optional(),
      providers: z
        .array(
          z.object({
            id: AiProviderSchema,
            enabled: z.boolean().optional(),
            apiKey: z.string().optional(),
            baseUrl: z.string().optional(),
            defaultModel: z.string().optional(),
          }),
        )
        .optional(),
      /** Sync intent flag used by explicit `eve ai sync --workspace <id>` command. */
      syncToSynap: z.boolean().optional(),
      /**
       * Per-service provider override. Keys are component ids
       * (e.g. "openclaw", "openwebui"); value is the provider id that
       * service should default to. Missing or null = use the global
       * `defaultProvider`.
       */
      serviceProviders: z
        .record(z.string(), AiProviderSchema)
        .optional(),
    })
    .optional(),
  synap: z
    .object({
      apiUrl: z.string().optional(),
      /**
       * Legacy single-key field. Kept as the back-compat alias for the
       * "eve" agent's key (mirrored on every renew) so older consumers
       * that read `secrets.synap.apiKey` keep working through one
       * release. New code should read `secrets.agents.eve.hubApiKey`.
       */
      apiKey: z.string().optional(),
      /** Full Hub base URL; if unset, Eve derives `${apiUrl}/api/hub` */
      hubBaseUrl: z.string().optional(),
    })
    .optional(),
  /**
   * Per-agent Hub Protocol keys minted via `POST /api/hub/setup/agent`.
   * Keys are agentType slugs from `@eve/dna/agents` (eve, openclaw,
   * hermes, openwebui-pipelines, ...). Each entry is the result of one
   * setup/agent call and is rotated independently by `eve auth renew
   * --agent <slug>`.
   *
   * Why a free-form record instead of fixed keys: the registry can grow
   * without forcing a schema migration. Unknown slugs are tolerated by
   * the schema (`z.record`) — readers gate on `resolveAgent()` from the
   * registry instead.
   */
  agents: z
    .record(
      z.string(),
      z.object({
        hubApiKey: z.string(),
        agentUserId: z.string(),
        workspaceId: z.string(),
        /** keyId returned from /setup/agent — useful for audit/dashboards. */
        keyId: z.string().optional(),
        /** Local-clock timestamp of the last successful mint. ISO-8601. */
        createdAt: z.string().optional(),
      }),
    )
    .optional(),
  inference: z
    .object({
      ollamaUrl: z.string().optional(),
      gatewayUrl: z.string().optional(),
      gatewayUser: z.string().optional(),
      gatewayPass: z.string().optional(),
    })
    .optional(),
  builder: z
    .object({
      /**
       * Selected code engine for the local `coder` agent. Defaults to
       * 'claudecode'. The Hub Protocol identity is always `coder` (one
       * agent slug, one Hub key); this field selects which CLI binary
       * Eve spawns when a coder task runs.
       *
       * Engine binaries handle their OWN auth — `claude` reads
       * ANTHROPIC_API_KEY from env, `opencode` has its own config dir,
       * `openclaude` reads its config from .eve/openclaude.json. We do
       * NOT keep per-engine API keys in this schema.
       */
      codeEngine: z.enum(['claudecode', 'opencode', 'openclaude']).optional(),
      /**
       * Workspace ID of the seeded Builder workspace on the user's pod.
       * Persisted by `ensureBuilderWorkspace()` after a successful
       * `POST /api/hub/workspaces/from-definition` so subsequent runs
       * (and Doctor probes) can introspect the seeded state.
       *
       * Idempotency on the pod side is keyed by the template's
       * `proposalId: "builder-workspace-v1"`, so even if this field is
       * lost the next ensure call will resolve back to the same row.
       */
      workspaceId: z.string().optional(),
      /** Legacy flat fields — may be deprecated when nested subsections are used */
      openclaudeUrl: z.string().optional(),
      dokployApiUrl: z.string().optional(),
      dokployApiKey: z.string().optional(),
      dokployWebhookUrl: z.string().optional(),
      workspaceDir: z.string().optional(),
      skillsDir: z.string().optional(),
      /** Hermes headless orchestrator daemon */
      hermes: z
        .object({
          enabled: z.boolean().optional(),
          pollIntervalMs: z.number().optional(),
          maxConcurrentTasks: z.number().optional(),
        })
        .optional(),
    })
    .optional(),
  arms: z
    .object({
      /** OpenClaw bridge config */
      openclaw: z
        .object({
          synapApiKey: z.string().optional(),
        })
        .optional(),
      /** Messaging platform bridges (Telegram, Signal, etc.) */
      messaging: z
        .object({
          enabled: z.boolean().optional(),
          platform: z.enum(['telegram', 'discord', 'signal', 'matrix']).optional(),
          botToken: z.string().optional(),
        })
        .optional(),
      /** Voice / telephony (SIP, Twilio, etc.) */
      voice: z
        .object({
          enabled: z.boolean().optional(),
          provider: z.enum(['twilio', 'signal', 'selfhosted']).optional(),
          phoneNumber: z.string().optional(),
          sipUri: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
  /** Eve web dashboard config */
  dashboard: z
    .object({
      secret: z.string().optional(),
      port: z.number().optional(),
    })
    .optional(),
  /**
   * Synap Control Plane user-scoped OAuth token (Eve OS Vision Phase 2).
   *
   * Eve queries the CP marketplace AS THE USER, not as a service. The
   * dashboard initiates an OAuth/PKCE handshake with the CP, receives
   * a user-scoped JWT, and persists it here. The token has narrow
   * scope (`marketplace:read marketplace:install`) and is used only
   * by the dashboard's server-side route handlers — it is never
   * exposed to client-side React state in plaintext.
   *
   * See: synap-team-docs/content/team/platform/eve-os-vision.mdx §6
   */
  cp: z
    .object({
      /** User-scoped JWT from the CP OAuth flow. */
      userToken: z.string().optional(),
      /** ISO-8601 timestamp the token was minted (for audit/debug). */
      issuedAt: z.string().optional(),
      /** Optional expiry hint (server-side decode of JWT exp). */
      expiresAt: z.string().optional(),
      /**
       * In-flight device authorization flows (RFC 8628), keyed by an
       * opaque handle the dashboard server hands to the browser. Each
       * entry stores the device_code (server-side secret) so subsequent
       * polling calls can resolve the handle without exposing the code
       * to the client. Entries are short-lived (15 min) and any
       * leftovers are ignored after expires_at — no GC required.
       */
      deviceFlow: z
        .record(
          z.object({
            deviceCode: z.string(),
            expiresAt: z.number(),
            interval: z.number(),
          }),
        )
        .optional(),
    })
    .optional(),
  /**
   * Pod credentials slot (Eve auth Phase 4).
   *
   * Holds Eve's own JWT-issuer keypair (Eve identifies as `iss = eve URL`
   * to the pod's `/api/hub/auth/exchange` endpoint, RFC 7523 JWT-Bearer
   * grant) plus the cached pod user-session token returned by that
   * exchange. The keypair is generated lazily on first need and the
   * public half is published at `/.well-known/jwks.json`.
   *
   * The two-channel rule (see eve-credentials.mdx):
   *   - `pod.userToken`     — user channel, fronts `/api/pod/*`.
   *   - `agents.eve.hubApiKey` (legacy `synap.apiKey`) — service channel,
   *                           fronts `/api/hub/*`. NEVER use it for user
   *                           actions.
   */
  pod: z
    .object({
      /** Pod's external base URL (back-compat: also stored at synap.apiUrl). */
      url: z.string().optional(),
      /**
       * Eve's issuer keypair. The private half NEVER leaves the host
       * (we keep file mode 0600 and never log it). The public half is
       * the only thing the pod ever fetches via JWKS.
       */
      issuer: z
        .object({
          /** JWK (private) — signing key. Kept here as `unknown` so
           *  that the on-disk JSON shape stays whatever `jose.exportJWK`
           *  produces today and tomorrow without a breaking schema bump. */
          privateJwk: z.unknown(),
          /** JWK (public) — published verbatim at `/.well-known/jwks.json`. */
          publicJwk: z.unknown(),
          /** Stable kid — used both as the JWT `kid` header and as the
           *  lookup key when the pod fetches our JWKS. 16 random bytes
           *  base64url-encoded so it survives URL embedding. */
          kid: z.string(),
          /** ISO-8601 — when this keypair was minted (audit trail). */
          createdAt: z.string(),
        })
        .optional(),
      /** Cached pod user-session token from the JWT-Bearer exchange. */
      userToken: z.string().optional(),
      /** ISO-8601 — when the userToken was minted. */
      userTokenIssuedAt: z.string().optional(),
      /** ISO-8601 — pod-asserted exp (or now+expires_in fallback). */
      userTokenExpiresAt: z.string().optional(),
      /** Email of the operator the userToken was minted for. */
      userEmail: z.string().optional(),
      /**
       * Optional bootstrap token cached from `eve install` — feeds the
       * Phase 5 "create first admin" UI without env-var fallback.
       * Forward-compat: the bootstrap-claim route already reads this.
       */
      bootstrapToken: z.string().optional(),
    })
    .optional(),
  /** Primary domain + SSL config */
  domain: z
    .object({
      primary: z.string().optional(),
      ssl: z.boolean().optional(),
      email: z.string().optional(),
      subdomains: z.record(z.string()).optional(),
      /** When true, Traefik runs HTTP-only and an external proxy handles SSL. */
      behindProxy: z.boolean().optional(),
    })
    .optional(),
});

export type EveSecrets = z.infer<typeof SecretsSchema>;

/**
 * Resolve the directory that contains `.eve/`.
 * Honors EVE_HOME so the dashboard container can read host-mounted secrets
 * even though its own cwd is the standalone bundle dir (`/app`).
 */
function defaultEveCwd(): string {
  return process.env.EVE_HOME || process.cwd();
}

export function secretsPath(cwd: string = defaultEveCwd()): string {
  return join(cwd, '.eve', 'secrets', 'secrets.json');
}

export async function readEveSecrets(cwd: string = defaultEveCwd()): Promise<EveSecrets | null> {
  const path = secretsPath(cwd);
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(await readFile(path, 'utf-8')) as unknown;
    return SecretsSchema.parse(raw);
  } catch {
    return null;
  }
}

function mergeNested<T extends Record<string, unknown>>(
  prev: T | undefined,
  next: T | undefined,
): T | undefined {
  if (next === undefined) return prev;
  if (prev === undefined) return next;
  const merged: Record<string, unknown> = { ...prev };
  for (const [k, v] of Object.entries(next)) {
    if (v !== undefined) merged[k] = v;
  }
  return merged as T;
}

export async function writeEveSecrets(
  partial: Omit<EveSecrets, 'version' | 'updatedAt'>,
  cwd: string = defaultEveCwd(),
): Promise<EveSecrets> {
  const current = (await readEveSecrets(cwd)) ?? {
    version: '1' as const,
    updatedAt: new Date().toISOString(),
  };
  const mergedAi = mergeNested(
    current.ai as Record<string, unknown> | undefined,
    partial.ai as Record<string, unknown> | undefined,
  );
  const mergedSynap = mergeNested(
    current.synap as Record<string, unknown> | undefined,
    partial.synap as Record<string, unknown> | undefined,
  );
  const mergedInference = mergeNested(
    current.inference as Record<string, unknown> | undefined,
    partial.inference as Record<string, unknown> | undefined,
  );
  const mergedBuilder = mergeNested(
    current.builder as Record<string, unknown> | undefined,
    partial.builder as Record<string, unknown> | undefined,
  );
  const mergedArms = mergeNested(
    current.arms as Record<string, unknown> | undefined,
    partial.arms as Record<string, unknown> | undefined,
  );
  const mergedDashboard = mergeNested(
    current.dashboard as Record<string, unknown> | undefined,
    partial.dashboard as Record<string, unknown> | undefined,
  );
  const mergedDomain = mergeNested(
    current.domain as Record<string, unknown> | undefined,
    partial.domain as Record<string, unknown> | undefined,
  );
  const mergedCp = mergeNested(
    current.cp as Record<string, unknown> | undefined,
    partial.cp as Record<string, unknown> | undefined,
  );
  const mergedPod = mergeNested(
    current.pod as Record<string, unknown> | undefined,
    partial.pod as Record<string, unknown> | undefined,
  );

  const next: EveSecrets = {
    ...current,
    ...partial,
    ai: mergedAi as EveSecrets['ai'],
    synap: mergedSynap as EveSecrets['synap'],
    inference: mergedInference as EveSecrets['inference'],
    builder: mergedBuilder as EveSecrets['builder'],
    arms: mergedArms as EveSecrets['arms'],
    dashboard: mergedDashboard as EveSecrets['dashboard'],
    domain: mergedDomain as EveSecrets['domain'],
    cp: mergedCp as EveSecrets['cp'],
    pod: mergedPod as EveSecrets['pod'],
    version: '1',
    updatedAt: new Date().toISOString(),
  };
  const parsed = SecretsSchema.parse(next);
  const path = secretsPath(cwd);
  await mkdir(join(cwd, '.eve', 'secrets'), { recursive: true });
  await writeFile(path, JSON.stringify(parsed, null, 2), { mode: 0o600 });
  return parsed;
}

export function ensureSecretValue(existing?: string): string {
  return existing && existing.trim().length > 0
    ? existing
    : randomBytes(24).toString('base64url');
}

/**
 * Per-agent record shape, narrower than the schema's `unknown` value type.
 * Returned by `readAgentKey` and accepted by `writeAgentKey`.
 */
export interface AgentKeyRecord {
  hubApiKey: string;
  agentUserId: string;
  workspaceId: string;
  keyId?: string;
  createdAt?: string;
}

/** Read one agent's key from secrets.json. Returns null when absent. */
export async function readAgentKey(
  agentType: string,
  cwd: string = defaultEveCwd(),
): Promise<AgentKeyRecord | null> {
  const secrets = await readEveSecrets(cwd);
  const entry = secrets?.agents?.[agentType];
  if (!entry || !entry.hubApiKey) return null;
  return entry as AgentKeyRecord;
}

/**
 * Read an agent's `hubApiKey`, falling back to the legacy single-key
 * field when the per-agent record doesn't exist yet.
 *
 * This is the helper every Synap consumer (Hermes, OpenClaw,
 * OpenWebUI Pipelines, Doctor) should use to get its bearer token.
 * Behavior:
 *   1. If `secrets.agents[agentType].hubApiKey` exists → return it.
 *   2. Else fall back to `secrets.synap.apiKey` (legacy single-key
 *      world). This keeps fresh installs and pre-migration installs
 *      working seamlessly.
 *
 * Returns an empty string when neither is set, so callers can pass
 * the result straight into env files / headers.
 */
export async function readAgentKeyOrLegacy(
  agentType: string,
  cwd: string = defaultEveCwd(),
): Promise<string> {
  const secrets = await readEveSecrets(cwd);
  const perAgent = secrets?.agents?.[agentType]?.hubApiKey?.trim();
  if (perAgent) return perAgent;
  return secrets?.synap?.apiKey?.trim() ?? '';
}

/**
 * Synchronous variant of `readAgentKeyOrLegacy` that takes an already-loaded
 * secrets blob. Useful for callers that have already paid the file read
 * cost and don't want to re-read inside a tight loop.
 */
export function readAgentKeyOrLegacySync(
  agentType: string,
  secrets: EveSecrets | null,
): string {
  const perAgent = secrets?.agents?.[agentType]?.hubApiKey?.trim();
  if (perAgent) return perAgent;
  return secrets?.synap?.apiKey?.trim() ?? '';
}

/**
 * Write one agent's key into secrets.json (merge-preserving).
 *
 * - Reads the current file (creates a baseline if missing).
 * - Replaces only `agents[agentType]` — every other field passes through.
 * - When `agentType === "eve"`, ALSO mirrors `hubApiKey` into the legacy
 *   `synap.apiKey` field so back-compat consumers (older OpenWebUI
 *   pipelines wiring, dashboard preview cards) keep working through the
 *   one-release transition.
 *
 * Caller-side concurrency: this function does a read-modify-write but
 * does NOT take a file lock. Eve's lifecycle path is single-threaded
 * (one `eve` invocation at a time), so a true lock is overkill. If two
 * provisioning runs ever overlap the LAST write wins — which is fine
 * for keys (both writes are valid, both keys live in the api_keys
 * table; only one is referenced from secrets.json afterwards).
 */
export async function writeAgentKey(
  agentType: string,
  record: AgentKeyRecord,
  cwd: string = defaultEveCwd(),
): Promise<EveSecrets> {
  const current = (await readEveSecrets(cwd)) ?? {
    version: '1' as const,
    updatedAt: new Date().toISOString(),
  };

  const nextAgents: Record<string, AgentKeyRecord> = {
    ...((current.agents ?? {}) as Record<string, AgentKeyRecord>),
    [agentType]: {
      ...record,
      createdAt: record.createdAt ?? new Date().toISOString(),
    },
  };

  const partial: Omit<EveSecrets, 'version' | 'updatedAt'> = {
    agents: nextAgents,
  };

  // Mirror the eve agent's key into the legacy field so older code that
  // reads `secrets.synap.apiKey` keeps working. We do this here (not in
  // the auth layer) so any path that mints an eve key — install,
  // renew, migrate — gets the back-compat alias for free.
  if (agentType === 'eve') {
    partial.synap = {
      ...(current.synap as Record<string, unknown> | undefined),
      apiKey: record.hubApiKey,
    };
  }

  return writeEveSecrets(partial, cwd);
}

// ---------------------------------------------------------------------------
// Code engine accessors (the `coder` agent's local CLI engine choice)
// ---------------------------------------------------------------------------

/**
 * Allowed values for `secrets.builder.codeEngine`. The `coder` agent
 * itself is a single Hub identity — this field only controls which
 * local CLI binary Eve spawns when running a coder task.
 */
export type CodeEngine = 'claudecode' | 'opencode' | 'openclaude';

/** Default engine when the operator hasn't picked one. */
export const DEFAULT_CODE_ENGINE: CodeEngine = 'claudecode';

/**
 * Read the operator's selected code engine. Returns `DEFAULT_CODE_ENGINE`
 * when nothing is configured. Pass `null` for "no secrets file yet" and
 * any partial blob otherwise.
 */
export function readCodeEngine(secrets: EveSecrets | null | undefined): CodeEngine {
  const e = secrets?.builder?.codeEngine;
  if (e === 'claudecode' || e === 'opencode' || e === 'openclaude') return e;
  return DEFAULT_CODE_ENGINE;
}

/**
 * Persist the engine choice into `secrets.builder.codeEngine` (merge-preserving).
 * Returns the resulting EveSecrets blob.
 *
 * Note: this only updates the *config*. The `coder` Hub key is minted
 * separately via `provisionAgent({ agentType: 'coder' })` — the engine
 * choice and the Hub identity are deliberately orthogonal.
 */
export async function writeCodeEngine(
  engine: CodeEngine,
  cwd: string = defaultEveCwd(),
): Promise<EveSecrets> {
  const current = (await readEveSecrets(cwd)) ?? {
    version: '1' as const,
    updatedAt: new Date().toISOString(),
  };
  const builder = {
    ...((current.builder ?? {}) as Record<string, unknown>),
    codeEngine: engine,
  };
  return writeEveSecrets(
    { builder: builder as EveSecrets['builder'] },
    cwd,
  );
}

// ---------------------------------------------------------------------------
// Pod-side credential accessors (Eve auth Phase 4)
// ---------------------------------------------------------------------------

/**
 * Eve's JWT issuer keypair, in the JWK shape `jose` produces. Both the
 * private and public halves live here; the public one is published at
 * `/.well-known/jwks.json` and the private one signs assertions for the
 * pod's `/api/hub/auth/exchange` endpoint.
 */
export interface PodIssuerKeyPair {
  privateJwk: JsonWebKey;
  publicJwk: JsonWebKey;
  kid: string;
}

/** Cached pod user-session record returned by the JWT-Bearer exchange. */
export interface PodUserTokenRecord {
  token: string;
  /** ISO-8601 expiry. May be in the past — callers MUST check before use. */
  expiresAt: string;
  /** Email the token was minted for. Used as a sanity check on next use. */
  email: string;
  /** ISO-8601 — when the token was minted (mostly for audit/debug). */
  issuedAt?: string;
}

/**
 * Read Eve's issuer keypair if one has been generated. Returns `null`
 * when the slot is empty so callers can decide whether to mint or fail.
 */
export async function readPodIssuer(
  cwd: string = defaultEveCwd(),
): Promise<PodIssuerKeyPair | null> {
  const secrets = await readEveSecrets(cwd);
  const issuer = secrets?.pod?.issuer;
  if (!issuer || !issuer.privateJwk || !issuer.publicJwk || !issuer.kid) {
    return null;
  }
  return {
    privateJwk: issuer.privateJwk as JsonWebKey,
    publicJwk: issuer.publicJwk as JsonWebKey,
    kid: issuer.kid,
  };
}

/**
 * Idempotent: returns the existing keypair if one is on disk, otherwise
 * generates a fresh ES256 pair via `jose`, persists it, and returns the
 * result.
 *
 * The kid is 16 random bytes base64url-encoded. We don't reuse the JWK
 * thumbprint because it'd be a bigger hassle to roll the key — every
 * verifier would have to refetch JWKS to learn the new thumbprint, and
 * a stable opaque string lets us decouple key material from identity.
 */
export async function ensurePodIssuer(
  cwd: string = defaultEveCwd(),
): Promise<PodIssuerKeyPair> {
  const existing = await readPodIssuer(cwd);
  if (existing) return existing;

  // `extractable: true` is required so we can `exportJWK` and persist
  // the private half. The keypair never leaves this host.
  const { privateKey, publicKey } = await generateKeyPair('ES256', {
    extractable: true,
  });
  const privateJwk = (await exportJWK(privateKey)) as JsonWebKey;
  const publicJwk = (await exportJWK(publicKey)) as JsonWebKey;
  const kid = randomBytes(16).toString('base64url');

  await writeEveSecrets(
    {
      pod: {
        issuer: {
          privateJwk,
          publicJwk,
          kid,
          createdAt: new Date().toISOString(),
        },
      },
    },
    cwd,
  );

  return { privateJwk, publicJwk, kid };
}

/**
 * Read the cached pod user-session token. Returns `null` when no token
 * is stored. Does NOT check expiry — that's the caller's job (see
 * `mintAndStorePodUserToken` in eve-dashboard).
 */
export async function readPodUserToken(
  cwd: string = defaultEveCwd(),
): Promise<PodUserTokenRecord | null> {
  const secrets = await readEveSecrets(cwd);
  const pod = secrets?.pod;
  if (!pod?.userToken || !pod.userTokenExpiresAt || !pod.userEmail) {
    return null;
  }
  return {
    token: pod.userToken,
    expiresAt: pod.userTokenExpiresAt,
    email: pod.userEmail,
    issuedAt: pod.userTokenIssuedAt,
  };
}

/** Persist a freshly minted pod user-session token (merge-preserving). */
export async function writePodUserToken(
  token: string,
  expiresAt: string,
  email: string,
  cwd: string = defaultEveCwd(),
): Promise<EveSecrets> {
  return writeEveSecrets(
    {
      pod: {
        userToken: token,
        userTokenExpiresAt: expiresAt,
        userTokenIssuedAt: new Date().toISOString(),
        userEmail: email,
      },
    },
    cwd,
  );
}

/**
 * Clear the cached user-session token. Used when the pod returns 401
 * — the next request will re-mint.
 *
 * `mergeNested` skips undefined values (so writing `userToken: undefined`
 * via the merge path is a no-op). To actually delete the keys we round-
 * trip the full file with the relevant keys removed.
 */
export async function clearPodUserToken(
  cwd: string = defaultEveCwd(),
): Promise<EveSecrets> {
  const current = await readEveSecrets(cwd);
  if (!current) {
    // Nothing to clear; return a baseline blob so callers can chain.
    return writeEveSecrets({}, cwd);
  }
  const pod = (current.pod ?? {}) as Record<string, unknown>;
  const stripped: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(pod)) {
    if (k === 'userToken' || k === 'userTokenExpiresAt' || k === 'userTokenIssuedAt') {
      continue;
    }
    stripped[k] = v;
  }

  // Direct file rewrite — the merge helper would re-add the cleared
  // keys on the next read otherwise.
  const path = secretsPath(cwd);
  const next: EveSecrets = {
    ...current,
    pod: stripped as EveSecrets['pod'],
    version: '1',
    updatedAt: new Date().toISOString(),
  };
  await mkdir(join(cwd, '.eve', 'secrets'), { recursive: true });
  await writeFile(path, JSON.stringify(next, null, 2), { mode: 0o600 });
  return next;
}
