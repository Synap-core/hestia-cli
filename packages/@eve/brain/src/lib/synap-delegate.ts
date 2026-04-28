import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface SynapDelegatePaths {
  repoRoot: string;
  synapScript: string;
  deployDir: string;
}

const CANDIDATE_PATHS = [
  '/opt/synap',
  '/opt/synap-backend',
  '/srv/synap',
  '/home/synap/synap-backend',
  '/root/synap-backend',
];

function tryPath(root: string): SynapDelegatePaths | null {
  if (!existsSync(root)) return null;
  const script = join(root, 'synap');
  if (!existsSync(script)) return null;
  const deployDir = join(root, 'deploy');
  if (!existsSync(join(deployDir, 'docker-compose.yml'))) return null;
  return { repoRoot: root, synapScript: script, deployDir };
}

/**
 * Resolves the synap-backend checkout path in this order:
 * 1. SYNAP_CLI env override
 * 2. SYNAP_REPO_ROOT env var
 * 3. Saved path in .eve/state.json (written by `eve brain init`)
 * 4. Well-known installation paths (/opt/synap, /opt/synap-backend, …)
 * 5. null — caller must prompt for the path
 */
export function resolveSynapDelegate(cwd?: string): SynapDelegatePaths | null {
  // 1. Explicit env override for the synap script itself
  const cliOverride = process.env.SYNAP_CLI?.trim();
  if (cliOverride && existsSync(cliOverride)) {
    const root = resolve(cliOverride, '..');
    const d = tryPath(root);
    if (d) return d;
  }

  // 2. SYNAP_REPO_ROOT env var
  const envRoot = process.env.SYNAP_REPO_ROOT?.trim();
  if (envRoot) {
    const d = tryPath(envRoot);
    if (d) return d;
  }

  // 3. Saved in state.json
  const statePath = join(cwd ?? process.cwd(), '.eve', 'state.json');
  if (existsSync(statePath)) {
    try {
      const state = JSON.parse(readFileSync(statePath, 'utf-8'));
      const savedRoot: string | undefined = state?.installed?.synap?.config?.repoRoot;
      if (savedRoot) {
        const d = tryPath(savedRoot);
        if (d) return d;
      }
    } catch {}
  }

  // 4. Common installation paths
  for (const candidate of CANDIDATE_PATHS) {
    const d = tryPath(candidate);
    if (d) return d;
  }

  return null;
}
