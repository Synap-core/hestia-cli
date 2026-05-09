import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync, spawnSync } from 'node:child_process';
import {
  ensureSynapLoopbackOverride,
  pruneOldImagesForRepo,
  discoverAndBackfillPodConfig,
} from '@eve/dna';
import { runSynapCli } from './synap-cli-delegate.js';

const SYNAP_BACKEND_REPO = 'https://github.com/synap-core/backend.git';

/**
 * Idempotently ensure `<repoRoot>/synap` is a git checkout of synap-backend.
 * If the dir is empty or missing, clones fresh. If it has a `.git`, no-op.
 * Throws on a non-empty non-git directory (would clobber user data).
 */
function ensureSynapBackendCheckout(repoRoot: string): void {
  if (existsSync(join(repoRoot, '.git'))) return;
  mkdirSync(repoRoot, { recursive: true });
  const isEmpty = readdirSafe(repoRoot).length === 0;
  if (!isEmpty) {
    throw new Error(
      `Cannot clone synap-backend into non-empty non-git dir ${repoRoot}. ` +
      `Move existing files away or set SYNAP_REPO_ROOT to a different path.`,
    );
  }
  const result = spawnSync('git', ['clone', '--depth', '1', SYNAP_BACKEND_REPO, repoRoot], {
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`git clone ${SYNAP_BACKEND_REPO} failed (exit ${result.status})`);
  }
}

function readdirSafe(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

export interface SynapImageInstallOptions {
  deployDir?: string;
  domain?: string;
  email?: string;
  adminEmail?: string;
  adminPassword?: string;
  adminBootstrapMode?: 'token' | 'preseed';
}

export interface SynapImageInstallResult {
  bootstrapToken: string;
  deployDir: string;
  containerName: string | null;
}

function gen(bytes = 32): string {
  return randomBytes(bytes).toString('hex');
}

function getSynapBackendContainer(): string | null {
  try {
    const out = execSync(
      'docker ps --filter "label=com.docker.compose.project=synap-backend" --filter "label=com.docker.compose.service=backend" --format "{{.Names}}"',
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] },
    ).trim();
    return out.split('\n')[0]?.trim() || null;
  } catch {
    return null;
  }
}

function connectToEveNetwork(containerName: string): void {
  try {
    execSync(`docker network connect eve-network ${containerName}`, {
      stdio: ['pipe', 'pipe', 'ignore'],
    });
  } catch {
    // Already connected — fine
  }
}


export async function installSynapFromImage(opts: SynapImageInstallOptions = {}): Promise<SynapImageInstallResult> {
  // `deployDir` is the synap-backend GIT REPO ROOT. The compose dir (where
  // docker-compose.yml lives, and where the loopback override + .env get
  // written) is `<deployDir>/deploy/`.
  const repoRoot = opts.deployDir ?? '/opt/synap-backend';
  const composeDir = join(repoRoot, 'deploy');

  let domain = opts.domain ?? 'localhost';
  if (domain === 'localhost') {
    const discovered = await discoverAndBackfillPodConfig(process.cwd());
    if (discovered.domain) {
      domain = discovered.domain;
    }
  }

  const adminBootstrapMode = opts.adminBootstrapMode ?? 'token';

  // 1. Ensure the synap-backend git checkout exists. The CLI binary
  //    (`<repoRoot>/synap`) is what we delegate to.
  ensureSynapBackendCheckout(repoRoot);

  // 2. Loopback override — eve owns docker-compose.override.yml so the
  //    on-host CLI can reach the backend at 127.0.0.1:4000 without going
  //    through Traefik. Written BEFORE the synap CLI runs so the recreated
  //    backend container starts with the binding already in place.
  try {
    const r = ensureSynapLoopbackOverride(composeDir);
    if (r.outcome === 'wrote') {
      console.log(`  Wrote loopback compose override at ${r.path}`);
    } else {
      console.log(`  Kept existing ${r.path} (${r.reason ?? 'user-owned'})`);
    }
  } catch (err) {
    console.warn(`  Could not write loopback override: ${err instanceof Error ? err.message : String(err)} (continuing — CLI will use public URL)`);
  }

  // 3. Reuse an existing bootstrap token if one is already in .env so
  //    proposal flows that depend on it stay stable across reinstalls.
  const envPath = join(composeDir, '.env');
  const existingEnv = existsSync(envPath) ? readFileSync(envPath, 'utf-8') : '';
  const existingToken = existingEnv.match(/^ADMIN_BOOTSTRAP_TOKEN=(.+)$/m)?.[1];
  const bootstrapToken = existingToken?.trim() ?? gen(16);

  // 4. Delegate the actual install to the canonical synap CLI. It owns
  //    .env scaffolding, kratos.yml generation, image pulls, migrations,
  //    container bring-up, and (on update) the canary force-recreate.
  const cliArgs = [
    '--from-image',
    '--non-interactive',
    '--dir', repoRoot,
    '--domain', domain,
    '--admin-bootstrap-mode', adminBootstrapMode,
  ];
  if (opts.email) cliArgs.push('--email', opts.email);
  if (opts.adminEmail) cliArgs.push('--admin-email', opts.adminEmail);
  if (opts.adminPassword) cliArgs.push('--admin-password', opts.adminPassword);
  if (adminBootstrapMode === 'token') cliArgs.push('--admin-bootstrap-token', bootstrapToken);

  const cliResult = runSynapCli('install', cliArgs);
  if (!cliResult.ok) {
    throw new Error(
      `synap install exited ${cliResult.exitCode}` +
      (cliResult.stderr ? `: ${cliResult.stderr}` : ''),
    );
  }

  // 5. Self-heal eve-specific .env vars the synap CLI doesn't set:
  //    PROVISIONING_TOKEN (eve mints agent keys with it). Idempotent —
  //    no-op when the token is already present.
  selfHealEveSpecificEnv(envPath);

  // 6. Connect to eve-network so Traefik can route to the backend.
  let containerName: string | null = null;
  for (let i = 0; i < 10; i++) {
    containerName = getSynapBackendContainer();
    if (containerName) break;
    await new Promise(r => setTimeout(r, 2000));
  }
  if (containerName) {
    connectToEveNetwork(containerName);
    console.log(`  Connected ${containerName} → eve-network`);
  }

  // 7. Reclaim disk by pruning old image versions. Failures are non-fatal.
  for (const repo of ['ghcr.io/synap-core/backend', 'ghcr.io/synap-core/pod-agent']) {
    try {
      const r = pruneOldImagesForRepo(repo, 3);
      if (r.removed.length > 0) {
        console.log(`  Pruned ${r.removed.length} old ${repo} image(s) (kept latest 3).`);
      }
    } catch { /* sandbox without docker images access */ }
  }

  // Re-read the bootstrap token in case the CLI generated a different one
  // (e.g. mode=preseed where eve doesn't pass --admin-bootstrap-token).
  const finalEnv = existsSync(envPath) ? readFileSync(envPath, 'utf-8') : '';
  const finalToken = finalEnv.match(/^ADMIN_BOOTSTRAP_TOKEN=(.+)$/m)?.[1]?.trim() ?? bootstrapToken;

  return { bootstrapToken: finalToken, deployDir: repoRoot, containerName };
}

/**
 * Self-heal eve-specific .env variables that the canonical synap CLI doesn't
 * know about. Idempotent: only writes when something is missing.
 *
 * - PROVISIONING_TOKEN: eve uses it to mint agent API keys. Old installs
 *   may have an empty placeholder from `.env.example`; generate one.
 */
function selfHealEveSpecificEnv(envPath: string): void {
  if (!existsSync(envPath)) return;
  let content = readFileSync(envPath, 'utf-8');
  let dirty = false;

  const tokenMatch = content.match(/^PROVISIONING_TOKEN=(.*)$/m);
  if (!tokenMatch || tokenMatch[1].trim() === '') {
    const newToken = gen();
    if (tokenMatch) {
      content = content.replace(/^PROVISIONING_TOKEN=.*$/m, `PROVISIONING_TOKEN=${newToken}`);
    } else {
      const sep = content.endsWith('\n') ? '' : '\n';
      content = `${content}${sep}PROVISIONING_TOKEN=${newToken}\n`;
    }
    dirty = true;
    console.log('  Generated PROVISIONING_TOKEN (was missing/empty — eve can now mint agent keys)');
  }

  if (dirty) {
    writeFileSync(envPath, content, { encoding: 'utf-8', mode: 0o600 });
  }
}
