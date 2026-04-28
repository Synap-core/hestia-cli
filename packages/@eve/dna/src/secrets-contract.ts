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
    })
    .optional(),
  synap: z
    .object({
      apiUrl: z.string().optional(),
      apiKey: z.string().optional(),
      /** Full Hub base URL; if unset, Eve derives `${apiUrl}/api/hub` */
      hubBaseUrl: z.string().optional(),
    })
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
      /** Selected code engine (defaults to 'openclaude') */
      codeEngine: z.enum(['opencode', 'openclaude', 'claudecode']).optional(),
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
          platform: z.enum(['telegram', 'signal', 'matrix']).optional(),
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

export function secretsPath(cwd: string = process.cwd()): string {
  return join(cwd, '.eve', 'secrets', 'secrets.json');
}

export async function readEveSecrets(cwd: string = process.cwd()): Promise<EveSecrets | null> {
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
  cwd: string = process.cwd(),
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
