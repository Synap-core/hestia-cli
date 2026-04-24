import { existsSync } from 'node:fs';
import { join } from 'node:path';

export interface SynapDelegatePaths {
  repoRoot: string;
  synapScript: string;
  deployDir: string;
}

/**
 * When SYNAP_REPO_ROOT points at a synap-backend checkout (with deploy/ + synap script),
 * Eve delegates install/ops to the official bash CLI instead of Eve-managed Docker brain.
 *
 * When managedBy: 'eve' (detected via state.json), the delegate becomes a bridge —
 * Eve CLI owns lifecycle (start/stop/update) and calls synap commands only for
 * Synap-specific operations (profile management, etc.).
 * When managedBy: 'manual', Eve reads Synap's state but doesn't modify it.
 */
export function resolveSynapDelegate(): SynapDelegatePaths | null {
  const repoRoot = process.env.SYNAP_REPO_ROOT?.trim();
  if (!repoRoot || !existsSync(repoRoot)) {
    return null;
  }
  const script = process.env.SYNAP_CLI?.trim() || join(repoRoot, 'synap');
  if (!existsSync(script)) {
    return null;
  }
  const deployDir = join(repoRoot, 'deploy');
  if (!existsSync(join(deployDir, 'docker-compose.yml'))) {
    return null;
  }
  return { repoRoot, synapScript: script, deployDir };
}
