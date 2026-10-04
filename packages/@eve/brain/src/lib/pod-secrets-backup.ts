/**
 * Pod-secrets backup — mirror the secrets that index existing volume data
 * (POSTGRES_PASSWORD, KRATOS_*, MINIO_*, TYPESENSE_*, etc.) from the synap
 * pod's `.env` into `secrets.json:synap.podSecrets`. If `.env` is ever lost
 * during a migration, eve can rehydrate it BEFORE the synap CLI runs —
 * preventing the catastrophic "stub .env locks postgres volume forever" case.
 *
 * Operator-configured values (DOMAIN, ADMIN_EMAIL, BACKEND_VERSION) are NOT
 * mirrored. Those are decisions or self-healing on the synap CLI side.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { synapConfigSet } from './synap-cli-delegate.js';
import { readEveSecrets, writeEveSecrets, POD_SECRET_KEY_NAMES, type EveSecrets, type PodSecretKey } from '@eve/dna';

/**
 * Critical pod secrets eve mirrors. If postgres/typesense/minio/kratos/hydra
 * volumes already exist on disk, regenerating any of these is a one-way
 * data-loss event — they're how the volumes encrypt/authenticate data.
 */
export const POD_SECRET_KEYS: readonly PodSecretKey[] = POD_SECRET_KEY_NAMES;

function readEnvLine(content: string, key: string): string | undefined {
  const m = content.match(new RegExp(`^${key}=(.*)$`, 'm'));
  return m?.[1]?.trim() || undefined;
}

/**
 * Read the current `.env` and copy non-empty pod secrets into
 * `secrets.json:synap.podSecrets`. Skips empty values so a half-populated
 * `.env` doesn't poison the backup. No-op when `.env` doesn't exist.
 *
 * Call this AFTER a successful `synap install` or `synap update`.
 */
export async function backupPodSecrets(envPath: string): Promise<{ captured: PodSecretKey[] }> {
  if (!existsSync(envPath)) return { captured: [] };
  const content = readFileSync(envPath, 'utf-8');

  const captured: PodSecretKey[] = [];
  const podSecrets: Partial<Record<PodSecretKey, string>> = {};
  for (const key of POD_SECRET_KEYS) {
    const value = readEnvLine(content, key);
    if (value) {
      podSecrets[key] = value;
      captured.push(key);
    }
  }

  if (captured.length === 0) return { captured: [] };

  await writeEveSecrets({
    synap: {
      podSecrets: {
        ...podSecrets,
        backedUpAt: new Date().toISOString(),
      },
    },
  });

  return { captured };
}

/**
 * Restore pod secrets from `secrets.json:synap.podSecrets` into `.env`,
 * filling ONLY values that are missing or empty. Never overwrites a
 * non-empty existing value. No-op when no eve backup exists or `.env`
 * doesn't exist (caller is expected to ensure `.env` exists first — fresh
 * `synap install` creates it).
 *
 * Written through the pod's ONE validated writer (`synap config set`, values
 * on stdin) — never a direct file write. Filling an EMPTY immutable secret is
 * allowed by the door; changing a set one is not, which is exactly this
 * function's contract.
 *
 * Call this BEFORE `synap update` so the synap CLI's `compose up` reads
 * a complete `.env`. Operator-set values (DOMAIN, ADMIN_*) are unaffected.
 */
export async function restorePodSecrets(envPath: string): Promise<{ restored: PodSecretKey[]; reason?: string }> {
  if (!existsSync(envPath)) return { restored: [], reason: '.env does not exist' };

  const secrets: EveSecrets | null = await readEveSecrets();
  const backup = secrets?.synap?.podSecrets;
  if (!backup) return { restored: [], reason: 'no eve backup available' };

  const content = readFileSync(envPath, 'utf-8');
  const missing: Partial<Record<PodSecretKey, string>> = {};
  for (const key of POD_SECRET_KEYS) {
    const backupValue = backup[key];
    if (!backupValue) continue;
    if (readEnvLine(content, key)) continue;
    missing[key] = backupValue;
  }
  if (Object.keys(missing).length === 0) return { restored: [] };

  const r = synapConfigSet(missing as Record<string, string>, { deployDir: dirname(envPath) });
  if (!r.ok) {
    return { restored: [], reason: `synap config set refused the restore: ${(r.stderr || r.stdout).trim()}` };
  }
  return { restored: r.changed.filter((k): k is PodSecretKey => (POD_SECRET_KEYS as readonly string[]).includes(k)) };
}
