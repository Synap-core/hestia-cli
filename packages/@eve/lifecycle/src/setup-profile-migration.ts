/**
 * One-shot migration: copy domain/email from `.eve/setup-profile.json`
 * (legacy source of truth for `network.synapHost` and
 * `synapInstall.tlsEmail`) into `~/.eve/secrets.json` (the new single
 * source of truth).
 *
 * Idempotent: only writes when secrets.json is missing the field. Safe
 * to call on every install / setup invocation — the no-op cost is one
 * file read.
 *
 * Why a migration: prior to gatherInstallConfig, eve setup wrote network
 * config to BOTH places (setup-profile.json + secrets.json), and they
 * could drift. Now writes go to secrets.json only. Existing servers may
 * have a setup-profile holding the latest values — this picks them up
 * on the next eve install / eve setup so users don't lose them.
 */

import {
  readEveSecrets,
  readSetupProfile,
  writeEveSecrets,
} from "@eve/dna";

export interface MigrationResult {
  /** Fields copied from setup-profile → secrets. Empty when no-op. */
  migrated: string[];
}

export async function migrateSetupProfileToSecrets(
  cwd: string,
): Promise<MigrationResult> {
  const [secrets, saved] = await Promise.all([
    readEveSecrets(cwd).catch(() => null),
    readSetupProfile(cwd).catch(() => null),
  ]);

  if (!saved) return { migrated: [] };

  const migrated: string[] = [];
  const patch: { domain?: { primary?: string; ssl?: boolean; email?: string } } = {};

  // Domain: prefer saved network.synapHost (newer), fall back to domainHint.
  const savedDomain =
    saved.network?.synapHost?.trim() ||
    saved.domainHint?.trim() ||
    undefined;
  if (
    savedDomain &&
    savedDomain !== "localhost" &&
    !secrets?.domain?.primary?.trim()
  ) {
    patch.domain = { ...patch.domain, primary: savedDomain };
    migrated.push("domain.primary");
  }

  // Email: only saved.synapInstall.tlsEmail is authoritative.
  const savedEmail = saved.synapInstall?.tlsEmail?.trim();
  if (savedEmail && !secrets?.domain?.email?.trim()) {
    patch.domain = { ...patch.domain, email: savedEmail };
    migrated.push("domain.email");
  }

  if (migrated.length === 0) return { migrated: [] };

  await writeEveSecrets(patch, cwd);
  return { migrated };
}
