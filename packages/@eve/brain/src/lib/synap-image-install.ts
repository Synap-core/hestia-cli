import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync, spawnSync } from 'node:child_process';
import {
  ensureSynapLoopbackOverride,
  pruneOldImagesForRepo,
  discoverAndBackfillPodConfig,
} from '@eve/dna';
import { runSynapCli, toPodFqdn } from './synap-cli-delegate.js';
import { backupPodSecrets, restorePodSecrets } from './pod-secrets-backup.js';

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
  /** Synap-backend git repo root (defaults to /opt/synap-backend). */
  deployDir?: string;
  domain?: string;
  email?: string;
  adminEmail?: string;
  adminPassword?: string;
  adminBootstrapMode?: 'token' | 'preseed';
  /**
   * Build images from source instead of pulling pre-built images. Routes
   * to `synap install --from-source`. Requires the deployDir to be a real
   * git checkout (not just an extracted tarball).
   */
  fromSource?: boolean;
  /** Pass `--with-openclaw` so the synap CLI provisions OpenClaw alongside the pod. */
  withOpenclaw?: boolean;
  /** Pass `--with-rsshub` so the synap CLI starts the rsshub compose profile. */
  withRsshub?: boolean;
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

  // Resolve the bare root domain (eve convention: `secrets.domain.primary`
  // and discovery both return the bare root, e.g. `team.thearchitech.xyz`).
  let bareDomain = opts.domain ?? 'localhost';
  if (bareDomain === 'localhost') {
    const discovered = await discoverAndBackfillPodConfig(process.cwd());
    if (discovered.domain) {
      bareDomain = discovered.domain;
    }
  }
  // The pod is reachable at `pod.<root>`. The synap CLI templates kratos URLs
  // as `https://${domain}/...` without prefixing — eve must pass the FQDN.
  const podDomain = toPodFqdn(bareDomain);

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
  const envExisted = existsSync(envPath);
  const existingEnv = envExisted ? readFileSync(envPath, 'utf-8') : '';
  const existingToken = existingEnv.match(/^ADMIN_BOOTSTRAP_TOKEN=(.+)$/m)?.[1];
  const bootstrapToken = existingToken?.trim() ?? gen(16);

  // 3b. Pre-CLI .env reconciliation when .env exists. Two concerns:
  //     a) Strip legacy KRATOS_CONFIG_DIR=./config/kratos (eve-flat-layout
  //        artefact) so the canonical compose default (../kratos) takes over.
  //     b) Restore pod-critical secrets from `secrets.json:synap.podSecrets`
  //        if the existing .env is missing them. Protects against a half-
  //        migrated .env (DOMAIN set, secrets blank) corrupting volume access.
  //     For fresh installs (.env missing), step 5 below captures the freshly-
  //     generated secrets after the synap CLI creates them.
  if (envExisted) {
    reconcileEveEnv(envPath);
    const restored = await restorePodSecrets(envPath);
    if (restored.restored.length > 0) {
      console.log(`  Restored ${restored.restored.length} pod secret(s) from eve backup: ${restored.restored.join(', ')}`);
    }
  }

  // 4. Delegate the actual install to the canonical synap CLI. It owns
  //    .env scaffolding, kratos.yml generation, image pulls, migrations,
  //    container bring-up, and (on update) the canary force-recreate.
  const cliArgs = [
    '--non-interactive',
    '--dir', repoRoot,
    '--domain', podDomain,
    '--admin-bootstrap-mode', adminBootstrapMode,
  ];
  cliArgs.push(opts.fromSource ? '--from-source' : '--from-image');
  if (opts.email) cliArgs.push('--email', opts.email);
  if (opts.adminEmail) cliArgs.push('--admin-email', opts.adminEmail);
  if (opts.adminPassword) cliArgs.push('--admin-password', opts.adminPassword);
  if (adminBootstrapMode === 'token') cliArgs.push('--admin-bootstrap-token', bootstrapToken);
  if (opts.withOpenclaw) cliArgs.push('--with-openclaw');
  if (opts.withRsshub) cliArgs.push('--with-rsshub');

  const cliResult = runSynapCli('install', cliArgs, { repoRoot });
  if (!cliResult.ok) {
    throw new Error(
      `synap install exited ${cliResult.exitCode}` +
      (cliResult.stderr ? `: ${cliResult.stderr}` : ''),
    );
  }

  // 5. Capture pod-critical secrets to eve's secrets.json so a future .env
  //    loss can be repaired. POSTGRES_PASSWORD / KRATOS_* / MINIO_* /
  //    TYPESENSE_* / etc. index existing volume data — losing them locks
  //    the volumes permanently. Best-effort: a backup write failure should
  //    never fail the install.
  try {
    const captured = await backupPodSecrets(envPath);
    if (captured.captured.length > 0) {
      console.log(`  Backed up ${captured.captured.length} pod secret(s) to secrets.json:synap.podSecrets`);
    }
  } catch (err) {
    console.warn(`  Could not back up pod secrets: ${err instanceof Error ? err.message : String(err)} (continuing — recovery from .env loss won't be available until next install/update)`);
  }

  // 6. Connect to eve-network so Traefik can route to the backend. The
  //    synap CLI waited for container health before returning, so the
  //    container should already be visible to `docker ps`.
  const containerName = getSynapBackendContainer();
  if (containerName) {
    connectToEveNetwork(containerName);
    console.log(`  Connected ${containerName} → eve-network`);
  } else {
    console.warn('  Backend container not found after synap install — skipping eve-network attach');
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
 * Strip eve-flat-layout legacy values from a migrated `.env`. The synap CLI
 * generates and self-heals everything else (PROVISIONING_TOKEN included as
 * of the upstream fix). The only thing the canonical CLI doesn't know about
 * is eve's previous bundled-compose layout — `KRATOS_CONFIG_DIR=./config/kratos`
 * was eve's value; canonical compose defaults to `../kratos` and breaks if
 * the legacy override is left in place.
 *
 * Returns `true` when the file was modified.
 */
export function reconcileEveEnv(envPath: string): boolean {
  if (!existsSync(envPath)) return false;
  let content = readFileSync(envPath, 'utf-8');

  const legacy = content.match(/^KRATOS_CONFIG_DIR=\.\/config\/kratos\s*$/m);
  if (!legacy) return false;

  content = content.replace(/^KRATOS_CONFIG_DIR=\.\/config\/kratos\s*\n?/m, '');
  writeFileSync(envPath, content, { encoding: 'utf-8', mode: 0o600 });
  console.log('  reconcile-env: removed legacy KRATOS_CONFIG_DIR=./config/kratos (canonical layout uses ../kratos)');
  return true;
}
