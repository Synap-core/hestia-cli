import { Command } from 'commander';
import { execa } from 'execa';
import { execSync, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { existsSync, readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getGlobalCliFlags } from '@eve/cli-kit';
import {
  runActionToCompletion,
  runBackendPreflight,
  provisionAllAgents,
} from '@eve/lifecycle';
import { findPodDeployDir, entityStateManager, readEveSecrets } from '@eve/dna';
import { runSynapCli, synapApply, synapConfigSet, synapUpdateArgs } from '@eve/brain';
import { installDashboardContainer, dashboardIsRunning } from '@eve/legs';
import { probeAdminStatus } from '../setup-admin.js';
import { randomBytes } from 'node:crypto';
import {
  printInfo,
  printSuccess,
  printWarning,
  printError,
  colors,
  createSpinner,
} from '../../lib/ui.js';

// ── helpers ───────────────────────────────────────────────────────────────────

const execFileAsync = promisify(execFile);

/** Create initial Nango admin account — idempotent, retries until container is ready. */
async function nangoAutoSignup(secretKey: string, ownerEmail?: string): Promise<void> {
  const email = ownerEmail ?? 'admin@eve.local';
  const pw = `Nango_${secretKey.slice(0, 12)}`;
  const node = `
    const attempt = (n) => fetch('http://localhost:3003/api/v1/account/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Admin', email: ${JSON.stringify(email)}, password: ${JSON.stringify(pw)} }),
    }).then(r => r.json()).then(d => {
      if (d?.data?.uuid || d?.error === 'account_already_exists') process.exit(0);
      if (n > 0) setTimeout(() => attempt(n - 1), 2000); else process.exit(1);
    }).catch(() => { if (n > 0) setTimeout(() => attempt(n - 1), 2000); else process.exit(1); });
    attempt(15);
  `;
  await execFileAsync('docker', ['exec', 'eve-arms-nango', 'node', '-e', node], { timeout: 40_000 }).catch(() => {/* non-fatal */});
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

function connectToEveNetwork(name: string): void {
  try {
    execSync(`docker network connect eve-network ${name}`, { stdio: ['pipe', 'pipe', 'ignore'] });
  } catch { /* already connected */ }
}

interface UpdateTarget {
  id: string;
  label: string;
  image?: string;
  container?: string;
  /** Returns optional sub-lines to render under the spinner success row. */
  update: () => Promise<{ subLines?: string[] } | void>;
}

/**
 * Pod Admin is shipped, migrated, and restarted by the canonical Synap CLI.
 * Keep it as a convenience update alias rather than inventing a second owner
 * with a partial service lifecycle.
 */
export function normalizeSynapManagedUpdateTargets(targets: Set<string> | null): boolean {
  if (!targets?.has('pod-admin')) return false;
  targets.delete('pod-admin');
  targets.add('synap');
  return true;
}

/**
 * Wrap `runActionToCompletion(id, "update")` so each top-level update
 * target is a thin shim that delegates to `@eve/lifecycle`. Single source
 * of truth: the lifecycle's UPDATE_PLAN handles compose/imagePull strategy,
 * recreate-vs-restart for env-bound components, missing-container drift,
 * and the obsolete-`version:` sanitization.
 */
function lifecycleUpdate(id: string, label: string): UpdateTarget {
  return {
    id,
    label,
    update: async () => {
      const result = await runActionToCompletion(id, 'update');
      if (!result.ok) {
        // Always include the last few log lines from the lifecycle
        // stream — without them the user sees only the headline (e.g.
        // "compose up exited 1") and has no way to tell whether it was
        // a missing network, port conflict, or pull failure. The outer
        // catch in `eve update` prints the full multi-line message.
        const tail = result.logs.slice(-6).join('\n');
        const headline = result.error ?? 'update failed';
        throw new Error(tail ? `${headline}\n${tail}` : headline);
      }
      // Surface post-update reconciliation log lines under the spinner.
      // OpenClaw gets a filtered headline; everything else gets all log lines
      // so operators can see what actually happened (env rewired, API called, etc.)
      if (id === 'openclaw') return { subLines: extractOpenclawSubLines(id, result.logs) };
      return { subLines: result.logs.filter(l => l.trim().length > 0) };
    },
  };
}

/**
 * Pick the headline reconciliation note out of the lifecycle log stream.
 *
 * The post-update hook prefixes each note with `OpenClaw:`; we surface
 * exactly one of those — the most informative — under the spinner. Keep
 * everything else quiet so the success summary stays tight.
 */
function extractOpenclawSubLines(id: string, logs: string[]): string[] {
  if (id !== 'openclaw') return [];
  const reconcileLogs = logs.filter(l => l.startsWith('OpenClaw:'));
  if (reconcileLogs.length === 0) return [];
  // Prefer the "re-added" line if present — that's the one the user wants
  // to see on the self-heal path. Otherwise fall back to whatever the
  // hook surfaced first (typically "already in sync").
  const reAdded = reconcileLogs.find(l => l.includes('re-added'));
  const headline = reAdded ?? reconcileLogs[0];
  // Strip the `OpenClaw: ` prefix — the spinner row already names the
  // component. Keep it short.
  return [headline.replace(/^OpenClaw:\s*/, 'reconciled allowedOrigins: ')];
}

/**
 * Locate the self-update script shipped alongside the CLI binary.
 *
 * Two cases:
 *   - Installed via bootstrap.sh → binary is /opt/eve/packages/eve-cli/dist/index.js
 *     → script at /opt/eve/scripts/self-update.sh
 *   - Dev mode (pnpm dev) → __dirname is packages/eve-cli/dist/
 *     → script at ../../scripts/self-update.sh (i.e. hestia-cli root)
 */
function findSelfUpdateScript(): string | null {
  const binDir = dirname(fileURLToPath(import.meta.url));
  // Walk up from the dist dir looking for scripts/self-update.sh
  let dir = binDir;
  for (let i = 0; i < 5; i++) {
    const candidate = join(dir, 'scripts', 'self-update.sh');
    if (existsSync(candidate)) return candidate;
    dir = dirname(dir);
  }
  return null;
}

/**
 * After a successful `eve update synap`, re-run agent provisioning so:
 *   - New agents introduced in this release get their first key minted.
 *   - Any first-install that previously failed auth gets a retry.
 *
 * skipIfPresent=true: keys that already exist are NOT re-minted — this
 * is an update, not a key rotation. Use `eve auth renew` for that.
 *
 * Never throws — this is a best-effort post-update hook. Returns sub-lines
 * for the spinner row so the user can see what happened without noise.
 */
async function tryPostUpdateProvision(_deployDir: string): Promise<{ subLines: string[] }> {
  const subLines: string[] = [];
  const eveCwd = process.cwd(); // Eve home — where secrets.json lives
  try {
    const preflight = await runBackendPreflight({ cwd: eveCwd });
    const adminStatus = await probeAdminStatus();
    if (adminStatus === 'needed') {
      subLines.push(`Admin setup required — run: eve setup admin`);
      return { subLines };
    }
    const installed = await entityStateManager.getInstalledComponents().catch(() => [] as string[]);
    const results = await provisionAllAgents({
      installedComponentIds: installed,
      deployDir: eveCwd,
      reason: 'post-update',
      synapUrl: preflight.synapUrl,
      provisioningToken: preflight.provisioningToken,
      skipIfPresent: true,
    });
    const ok = results.filter(r => r.provisioned).length;
    const failed = results.filter(r => !r.provisioned);
    if (failed.length > 0) {
      subLines.push(`${failed.length} agent key(s) failed — run: eve auth provision`);
    } else if (ok > 0) {
      subLines.push(`${ok} agent key${ok === 1 ? '' : 's'} verified`);
    }
  } catch {
    subLines.push('Agent provision skipped (backend not ready — run: eve auth provision)');
  }
  return { subLines };
}

async function buildUpdateTargets(deployDir: string | undefined, synapRelease?: string, synapFromSource = false): Promise<UpdateTarget[]> {
  const targets: UpdateTarget[] = [];

  // Read installed component set once — guards all optional targets below.
  // Falls back to empty on any read error so a corrupt state file never
  // blocks updates of components the user explicitly names.
  const installed = await entityStateManager.getInstalledComponents().catch(() => [] as string[]);
  const has = (id: string) => installed.includes(id);

  // Eve CLI self-update — runs scripts/self-update.sh which does:
  //   git pull + pnpm install + build + re-link /usr/local/bin/eve
  targets.push({
    id: 'eve',
    label: '🌿 Eve CLI',
    update: async () => {
      const script = findSelfUpdateScript();
      if (!script) {
        throw new Error(
          'self-update.sh not found — Eve may have been installed outside of git. ' +
          'To update manually: cd /opt/eve && git pull && pnpm install && pnpm --filter @synap-core/eve... run build',
        );
      }
      const result = spawnSync('bash', [script], { stdio: 'inherit' });
      if (result.status !== 0) {
        throw new Error(`self-update.sh exited ${result.status ?? 'unknown'}`);
      }
    },
  });

  // Synap delegates to the canonical synap-backend bash CLI, which owns the
  // canary-first update flow, kratos-migrate force-recreate, CREATE DATABASE
  // idempotency, and migration sequencing. Eve still handles the cross-project
  // plumbing (eve-network attach, agent provisioning) afterwards.
  // See: hestia-cli/.docs/synap-cli-as-source-of-truth.md
  if (deployDir) {
    targets.push({
      id: 'synap',
      label: '🧠 Synap Data Pod',
      update: async () => {
        // Resolve the bare root domain so the CLI heals an existing .env
        // whose DOMAIN= line was written before eve enforced the pod FQDN.
        const secrets = await readEveSecrets().catch(() => null);
        const bareDomain = secrets?.domain?.primary;
        // `synap update [--release <ref>]` — the one engine: release
        // manifest, verified backup, canary, automatic rollback. No git
        // refresh of the pod checkout (update-door plan P4).
        const result = runSynapCli('update', synapUpdateArgs(synapRelease, synapFromSource), {
          domain: bareDomain,
        });
        if (!result.ok) {
          throw new Error(
            `synap update exited ${result.exitCode}` +
            (result.stderr ? `: ${result.stderr}` : ''),
          );
        }
        const name = getSynapBackendContainer();
        if (name) connectToEveNetwork(name);

        // Post-update: mint agent keys for any new agents added in this
        // release, and verify existing ones are still valid. Best-effort
        // — a provision failure never blocks the update itself.
        return tryPostUpdateProvision(deployDir);
      },
    });
  }

  // Optional components — only added when they were part of the user's
  // setup. `has(id)` checks state.json's setupProfile.components[] so we
  // never attempt to update a service that was never installed.
  if (has('ollama'))              targets.push(lifecycleUpdate('ollama', '🤖 Ollama'));
  if (has('freellmapi'))          targets.push(lifecycleUpdate('freellmapi', '🎰 FreeLLMAPI'));
  if (has('omniroute'))            targets.push(lifecycleUpdate('omniroute', '🧭 OmniRoute'));
  if (has('openclaw'))            targets.push(lifecycleUpdate('openclaw', '🦾 OpenClaw'));
  if (has('nango'))               targets.push({
    id: 'nango',
    label: '🔗 Nango',
    update: async () => {
      const { readEveSecrets } = await import('@eve/dna');
      const { randomUUID } = await import('node:crypto');
      const { writeEveSecrets } = await import('@eve/dna');
      const secrets = await readEveSecrets(process.cwd()).catch(() => null);
      let secretKey = secrets?.connectors?.nango?.secretKey as string | undefined;
      if (!secretKey) throw new Error('No Nango secret key found in secrets.json — run: eve add nango');
      // Nango requires UUID v4 — regenerate if the stored key is a legacy hex string
      const uuidV4Re = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (!uuidV4Re.test(secretKey)) {
        secretKey = randomUUID();
        await writeEveSecrets({ connectors: { nango: { secretKey } } });
      }
      const domain = secrets?.domain?.primary as string | undefined;
      // Default to https for any public domain — Traefik always terminates SSL.
      const ssl = secrets?.domain?.ssl !== false;
      const nangoHost = domain ? `${ssl ? 'https' : 'http'}://nango.${domain}` : 'http://eve-arms-nango:3003';
      const podPublicUrl = domain ? `${ssl ? 'https' : 'http'}://${domain}` : '';
      // Read postgres credentials from deploy/.env
      let pgUser = 'synap';
      let pgPass = 'synap';
      const dDir0 = findPodDeployDir() ?? undefined;
      if (dDir0) {
        const { readFile: rf0 } = await import('node:fs/promises');
        const { join: pj0 } = await import('node:path');
        const e0 = await rf0(pj0(dDir0, '.env'), 'utf8').catch(() => '');
        const mu = e0.match(/^POSTGRES_USER=(.+)$/m); if (mu?.[1]) pgUser = mu[1].trim();
        const mp = e0.match(/^POSTGRES_PASSWORD=(.+)$/m); if (mp?.[1]) pgPass = mp[1].trim();
      }
      await execFileAsync('docker', ['pull', 'nangohq/nango-server:hosted'], { timeout: 120_000 });
      await execFileAsync('docker', ['rm', '-f', 'eve-arms-nango'], { timeout: 10_000 }).catch(() => {});
      // Find postgres by compose labels, create nango DB, and connect to eve-network
      const pgOut = await execFileAsync('docker', [
        'ps', '--filter', 'label=com.docker.compose.project=synap-backend',
        '--filter', 'label=com.docker.compose.service=postgres', '--format', '{{.Names}}',
      ], { timeout: 4000 }).catch(() => ({ stdout: '' }));
      const pgContainer = pgOut.stdout.trim().split('\n')[0]?.trim();
      if (pgContainer) {
        await execFileAsync('docker', ['exec', pgContainer, 'psql', '-U', pgUser, '-c', 'CREATE DATABASE nango;'], { timeout: 10_000 }).catch(() => {});
        await execFileAsync('docker', ['network', 'connect', '--alias', 'eve-brain-postgres', 'eve-network', pgContainer], { timeout: 10_000 }).catch(() => {});
      }
      const runArgs = [
        'run', '-d', '--name', 'eve-arms-nango', '--network', 'eve-network', '--restart', 'unless-stopped',
        '-e', `NANGO_SECRET_KEY=${secretKey}`, '-e', 'SERVER_PORT=3003',
        '-e', `NANGO_DATABASE_URL=postgresql://${pgUser}:${pgPass}@eve-brain-postgres:5432/nango`,
        '-e', 'NODE_ENV=production',
        '-e', 'NANGO_EMAIL_ACCOUNT_VERIFICATION_REQUIRED=false',
        ...(nangoHost ? ['-e', `NANGO_SERVER_URL=${nangoHost}`] : []),
        ...(podPublicUrl ? ['-e', `NANGO_WEBHOOK_URL=${podPublicUrl}/api/connectors/nango-webhook`] : []),
        '-v', 'eve-arms-nango-data:/var/lib/nango',
        'nangohq/nango-server:hosted',
      ];
      await execFileAsync('docker', runArgs, { timeout: 30_000 });
      const ownerEmail = secrets?.synap?.userSession?.email ?? (secrets?.builder?.openwebui as Record<string, unknown> | undefined)?.adminEmail as string | undefined;
      await nangoAutoSignup(secretKey, ownerEmail);
      // NANGO_HOST / NANGO_SECRET_KEY → the pod's .env through its ONE
      // validated writer, then `synap apply` recreates what reads them. (A
      // `docker restart` here never re-read .env — the new key never landed.)
      const dDir = findPodDeployDir() ?? undefined;
      if (dDir) {
        const written = synapConfigSet({ NANGO_HOST: nangoHost, NANGO_SECRET_KEY: secretKey }, { deployDir: dDir });
        if (!written.ok) throw new Error(`synap config refused the Nango keys: ${(written.stderr || written.stdout).trim()}`);
        if (written.changed.length > 0) {
          const applied = synapApply({ deployDir: dDir });
          if (!applied.ok) throw new Error(`synap apply failed: ${(applied.stderr || applied.stdout).trim().split('\n').slice(-2).join(' ')}`);
        }
        const container = getSynapBackendContainer();
        if (container) connectToEveNetwork(container);
      }
      return { subLines: [`image updated, container recreated with NANGO_DATABASE_URL`] };
    },
  });
  if (has('rsshub'))              targets.push(lifecycleUpdate('rsshub', '👁️  RSSHub'));
  if (has('traefik'))             targets.push(lifecycleUpdate('traefik', '🦿 Traefik'));
  if (has('openwebui'))           targets.push(lifecycleUpdate('openwebui', '💬 Open WebUI'));
  if (has('openwebui-pipelines')) targets.push(lifecycleUpdate('openwebui-pipelines', '🪈 Pipelines'));
  if (has('hermes'))              targets.push(lifecycleUpdate('hermes', '🧠 Hermes'));
  if (has('stalwart'))            targets.push(lifecycleUpdate('stalwart', '📧 Stalwart Mail'));
  if (has('bulwark'))             targets.push(lifecycleUpdate('bulwark', '✉️  Bulwark Webmail'));

  // Traefik can recreate its container on update; reconnect synap to
  // eve-network afterwards so cross-container DNS keeps working. (Done
  // here rather than in the lifecycle because eve-network reconnect is
  // a `eve update` orchestration concern, not a per-component one.)
  const traefikTarget = targets.find(t => t.id === 'traefik');
  if (traefikTarget) {
    const inner = traefikTarget.update;
    traefikTarget.update = async () => {
      await inner();
      const name = getSynapBackendContainer();
      if (name) connectToEveNetwork(name);
    };
  }

  // Eve Dashboard — rebuild the container image so UI changes from the
  // Eve CLI git pull land. Only added when the dashboard container is
  // currently running (i.e. it was installed with `eve add eve-dashboard`).
  if (dashboardIsRunning()) {
    targets.push({
      id: 'eve-dashboard',
      label: '📊 Eve Dashboard',
      update: async () => {
        const secrets = await readEveSecrets(process.cwd());
        const secret = secrets?.dashboard?.secret
          ?? randomBytes(24).toString('hex');
        installDashboardContainer({
          workspaceRoot: process.cwd(),
          secret,
          rebuild: true,
        });
        return { subLines: ['image rebuilt from updated source'] };
      },
    });
  }

  return targets;
}

async function confirmDestructiveReset(): Promise<boolean> {
  const flags = getGlobalCliFlags();
  if (flags.nonInteractive) return true;

  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question("Type 'recreate' to continue: ");
    return answer.trim() === 'recreate';
  } finally {
    rl.close();
  }
}

/**
 * A Synap pod deploy dir: it ships the pgdata guard, or its compose file runs
 * the Synap backend image.
 */
export function isSynapDeployDir(dir: string): boolean {
  if (existsSync(join(dir, 'pgdata-safety.sh'))) return true;
  const compose = join(dir, 'docker-compose.yml');
  if (!existsSync(compose)) return false;
  try {
    return readFileSync(compose, 'utf-8').includes('synap-core/backend');
  } catch {
    return false;
  }
}

export interface RecreateDeps {
  exec: (cmd: string, args: string[]) => Promise<unknown>;
  runSynap: typeof runSynapCli;
  confirm: () => Promise<boolean>;
  log: (line: string) => void;
}

const defaultRecreateDeps: RecreateDeps = {
  exec: (cmd, args) => execa(cmd, args, { stdio: 'inherit' }),
  runSynap: runSynapCli,
  confirm: confirmDestructiveReset,
  log: printInfo,
};

/**
 * `eve recreate` — down + up of the compose stack in `cwd`.
 *
 * It NEVER removes volumes (update-door plan P0, 2026-10-04): it used to run
 * `compose down --volumes` and `docker system prune -a -f --volumes` by
 * default, which together are the 2026-10-02 pod-wipe chain. In a Synap
 * deploy dir it does not touch compose at all: a bare `docker compose` there
 * bypasses the synap CLI's pgdata guard and has no pinned project name, so it
 * delegates to `synap reset --full` (verified backup, typed domain, volumes
 * kept, reinstall). Returns the exit code.
 */
export async function runRecreate(
  opts: { cwd: string; prune: boolean },
  deps: RecreateDeps = defaultRecreateDeps,
): Promise<number> {
  const synap = isSynapDeployDir(opts.cwd);
  console.log(colors.error.bold('\n⚠️  Recreate: stop and rebuild the stack\n'));
  console.log('This command will:');
  if (synap) {
    console.log('  - back up every Synap database, then run `synap reset --full` (it asks for the pod domain)');
    console.log('  - recreate the pod\'s containers and networks — volumes (your data) are KEPT');
  } else {
    console.log('  - stop and remove the compose containers and networks in the current directory');
    console.log('  - keep every volume');
    if (opts.prune) console.log('  - prune unused Docker images');
  }
  console.log('');

  if (!(await deps.confirm())) {
    deps.log('Cancelled.');
    return 0;
  }

  if (synap) {
    // A Synap pod deploy dir ships its own verified dumper. Take a backup of
    // every database to deploy/backups/postgres (a host dir outside Docker's
    // volume store) BEFORE anything else, and refuse to continue if it fails.
    if (existsSync(join(opts.cwd, 'pgdata-safety.sh'))) {
      deps.log('Backing up every Synap database before the reset...');
      await deps.exec('bash', [join(opts.cwd, 'pgdata-safety.sh'), 'backup', 'pre-recreate']);
    }
    const repoRoot = dirname(opts.cwd);
    if (!existsSync(join(repoRoot, 'synap'))) {
      printError(
        `No synap CLI at ${join(repoRoot, 'synap')}. Refusing to run bare docker compose on a Synap pod ` +
          '(it bypasses the data-placement guard). Use the synap CLI or deploy/update-pod.sh.',
      );
      return 1;
    }
    deps.log('Delegating to `synap reset --full`...');
    const result = deps.runSynap('reset', ['--full'], { repoRoot });
    if (!result.ok) {
      printError(result.stderr || `synap reset --full exited ${result.exitCode}`);
      return result.exitCode > 0 ? result.exitCode : 1;
    }
    return 0;
  }

  deps.log('Stopping stack and removing containers (volumes kept)...');
  await deps.exec('docker', ['compose', 'down', '--remove-orphans']);

  if (opts.prune) {
    deps.log('Pruning unused Docker images...');
    await deps.exec('docker', ['image', 'prune', '-a', '-f']);
  }

  deps.log('Recreating stack...');
  await deps.exec('docker', ['compose', 'up', '-d']);
  deps.log('Done. Stack recreated; volumes untouched.');
  return 0;
}

export function backupUpdateCommands(program: Command): void {
  program
    .command('backup')
    .description('List Eve-related Docker volumes (full backup: stop stack + docker run volume export — see docs)')
    .action(async () => {
      try {
        const { stdout } = await execa('docker', ['volume', 'ls', '--format', '{{.Name}}']);
        const vols = stdout
          .split('\n')
          .filter((n) => n.includes('eve') || n.includes('ollama') || n.includes('synap') || n.includes('openwebui'));
        if (vols.length === 0) {
          printInfo('No matching volumes found. Create the stack with eve brain init first.');
          return;
        }
        console.log(colors.primary.bold('Docker volumes (candidates for backup):\n'));
        for (const v of vols) {
          console.log(`  ${v}`);
        }
        printInfo('\nTip: align volume backups with your synap-backend deploy backup process when on production.');
      } catch (e) {
        printError(e instanceof Error ? e.message : String(e));
        process.exit(1);
      }
    });

  program
    .command('update')
    // `[components...]` accepts zero or more positional component IDs.
    // No args = update all. Args = scope to those components. This is the
    // most natural CLI shape and what the user expects from
    // `eve update openwebui`. `--only` is kept for backwards compat.
    .argument('[components...]', 'Component ids to update (omit to update all; `pod-admin` updates Synap)')
    .description('Update Eve components. Synap owns its bundled Pod Admin lifecycle, so `eve update pod-admin` updates the Data Pod safely.')
    .option('--only <organs>', 'Comma-separated organs to update (deprecated — use positional args)')
    .option('--skip <organs>', 'Comma-separated organs to skip, e.g. traefik')
    .option('--release <ref>', 'Synap release to apply: a release id (v1.2.3, main-<sha7>) or a channel (fast|stable). Default: the pod\'s SYNAP_UPDATE_CHANNEL, else stable')
    .option('--from-source', 'Synap: pull and build this pod\'s git checkout instead of a published release (same backup + rollback)')
    .action(async (components: string[] | undefined, opts: { only?: string; skip?: string; release?: string; fromSource?: boolean }) => {
      if (opts.fromSource && opts.release) {
        throw new Error('Pass either --release or --from-source, not both.');
      }
      // Use findPodDeployDir() — the canonical resolver used everywhere else
      // (preflight, doctor, lifecycle). It checks SYNAP_DEPLOY_DIR env var
      // first, then walks candidate paths including /opt/synap-backend/deploy
      // and /opt/synap-backend. The old hardcoded list missed the deploy/
      // subdirectory layout and couldn't be overridden without changing code.
      const deployDir = findPodDeployDir() ?? undefined;

      const targets = await buildUpdateTargets(deployDir, opts.release, opts.fromSource === true);

      // Positional args take precedence over `--only`. If the user passes
      // both, positional wins (more specific intent).
      const positionalSet = components && components.length > 0
        ? new Set(components)
        : null;
      const only = positionalSet
        ?? (opts.only ? new Set(opts.only.split(',').map(s => s.trim())) : null);
      const podAdminRequested = normalizeSynapManagedUpdateTargets(only);
      if (podAdminRequested) {
        printInfo('Pod Admin is released with Synap; updating the Synap Data Pod.');
      }
      const skip = opts.skip ? new Set(opts.skip.split(',').map(s => s.trim())) : new Set<string>();
      if (normalizeSynapManagedUpdateTargets(skip)) {
        printInfo('Pod Admin cannot be updated separately; skipping it skips the Synap Data Pod.');
      }

      // Validate positional ids — fail fast on typos rather than silently
      // doing nothing when none of the args match a target.
      if (positionalSet) {
        const known = new Set(targets.map(t => t.id));
        const unknown = [...positionalSet].filter(id => !known.has(id));
        if (unknown.length > 0) {
          printError(`Unknown component(s): ${unknown.join(', ')}`);
          printInfo(`  Available: ${[...known].join(', ')}`);
          process.exit(1);
        }
      }

      const toUpdate = targets.filter(t =>
        (!only || only.has(t.id)) && !skip.has(t.id),
      );

      if (toUpdate.length === 0) {
        printWarning('Nothing to update — filter excluded every target.');
        return;
      }

      console.log();
      console.log(colors.primary.bold('Eve Update'));
      console.log(colors.muted('─'.repeat(50)));

      const results: { label: string; ok: boolean; msg?: string }[] = [];

      for (const target of toUpdate) {
        const spinner = createSpinner(`Updating ${target.label}...`);
        spinner.start();
        try {
          const outcome = await target.update();
          spinner.succeed(`${target.label} updated`);
          // Render any post-update sub-lines (e.g. OpenClaw allowedOrigins
          // reconciliation) directly under the spinner row so the user
          // sees what self-heal happened. Quiet by default — only emits
          // when the lifecycle actually did something worth reporting.
          const subLines = outcome?.subLines ?? [];
          for (const line of subLines) {
            console.log(`  ${colors.muted('↳')} ${colors.muted(line)}`);
          }
          results.push({ label: target.label, ok: true });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          // Warn with the headline; print the full multi-line context
          // (log tail from the lifecycle generator) directly afterwards
          // so the user can actually diagnose what went wrong rather
          // than seeing only "compose up exited 1".
          spinner.warn(`${target.label} — skipped (${msg.split('\n')[0]})`);
          const remainder = msg.split('\n').slice(1);
          if (remainder.length > 0) {
            for (const line of remainder) {
              console.log(`  ${colors.muted('│')} ${line.trim()}`);
            }
          }
          results.push({ label: target.label, ok: false, msg });
        }
      }

      console.log();
      const failed = results.filter(r => !r.ok);
      if (failed.length === 0) {
        printSuccess('All organs updated.');
      } else {
        printWarning(`${results.filter(r => r.ok).length}/${results.length} updated. Skipped:`);
        for (const f of failed) {
          console.log(`  ${colors.muted('→')} ${f.label}: ${colors.muted(f.msg?.split('\n')[0] ?? '')}`);
        }
      }
      console.log();
    });

  program
    .command('recreate')
    .description('Recreate the stack in the current directory (volumes are kept). In a Synap deploy dir this delegates to the guarded `synap reset --full`.')
    .option('--no-prune', 'Skip pruning unused Docker images')
    .action(async (opts: { prune?: boolean }) => {
      try {
        const code = await runRecreate({ cwd: process.cwd(), prune: opts.prune !== false });
        if (code !== 0) process.exit(code);
      } catch (e) {
        printError(e instanceof Error ? e.message : String(e));
        process.exit(1);
      }
    });

  program
    .command('restart')
    .argument('[components...]', 'Component ids to restart (omit to restart all). E.g. `eve restart synap openwebui`')
    .description('Restart one or more Eve components without pulling new images.')
    .action(async (components: string[]) => {
      const knownIds = ['synap', 'ollama', 'openclaw', 'nango', 'rsshub', 'traefik', 'openwebui', 'openwebui-pipelines', 'hermes'];

      const toRestart = components.length > 0 ? components : knownIds;

      const unknown = toRestart.filter(id => !knownIds.includes(id));
      if (unknown.length > 0) {
        printError(`Unknown component(s): ${unknown.join(', ')}`);
        printInfo(`  Available: ${knownIds.join(', ')}`);
        process.exit(1);
      }

      console.log();
      console.log(colors.primary.bold('Eve Restart'));
      console.log(colors.muted('─'.repeat(50)));

      for (const id of toRestart) {
        const spinner = createSpinner(`Restarting ${id}…`);
        spinner.start();
        try {
          const result = await runActionToCompletion(id, 'restart');
          if (result.ok) {
            spinner.succeed(`${id} restarted`);
          } else {
            spinner.warn(`${id} — ${result.error ?? 'not running or not installed'}`);
          }
        } catch (e) {
          spinner.warn(`${id} — ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      console.log();
    });
}
