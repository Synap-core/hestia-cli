import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
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
    })
    .optional(),
  /** Primary domain + SSL config */
  domain: z
    .object({
      primary: z.string().optional(),
      ssl: z.boolean().optional(),
      email: z.string().optional(),
      subdomains: z.record(z.string()).optional(),
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

