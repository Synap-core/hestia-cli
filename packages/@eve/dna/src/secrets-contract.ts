import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';

const SecretsSchema = z.object({
  version: z.literal('1'),
  updatedAt: z.string(),
  synap: z
    .object({
      apiUrl: z.string().optional(),
      apiKey: z.string().optional(),
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
      openclaudeUrl: z.string().optional(),
      dokployApiUrl: z.string().optional(),
      dokployApiKey: z.string().optional(),
      workspaceDir: z.string().optional(),
    })
    .optional(),
  arms: z
    .object({
      openclawSynapApiKey: z.string().optional(),
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

  const next: EveSecrets = {
    ...current,
    ...partial,
    synap: mergedSynap as EveSecrets['synap'],
    inference: mergedInference as EveSecrets['inference'],
    builder: mergedBuilder as EveSecrets['builder'],
    arms: mergedArms as EveSecrets['arms'],
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
