import { Command } from 'commander';
import { execa } from 'execa';
import { execSync, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getGlobalCliFlags } from '@eve/cli-kit';
import {
  runActionToCompletion,
  runBackendPreflight,
  provisionAllAgents,
  checkNeedsAdmin,
} from '@eve/lifecycle';
import { findPodDeployDir, entityStateManager, readEveSecrets } from '@eve/dna';
import { runSynapCli } from '@eve/brain';
import { installDashboardContainer, dashboardIsRunning } from '@eve/legs';
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
    const needsAdmin = await checkNeedsAdmin(preflight.synapUrl, preflight.provisioningToken);
    if (needsAdmin) {
      subLines.push(`Admin setup required — run: eve auth provision`);
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

async function buildUpdateTargets(deployDir: string | undefined): Promise<UpdateTarget[]> {
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
          'To update manually: cd /opt/eve && git pull && pnpm install && pnpm --filter @eve/cli... run build',
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
        const result = runSynapCli('update', ['--from-image'], {
          refreshGit: true,
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
  if (has('openclaw'))            targets.push(lifecycleUpdate('openclaw', '🦾 OpenClaw'));
  if (has('rsshub'))              targets.push(lifecycleUpdate('rsshub', '👁️  RSSHub'));
  if (has('traefik'))             targets.push(lifecycleUpdate('traefik', '🦿 Traefik'));
  if (has('openwebui'))           targets.push(lifecycleUpdate('openwebui', '💬 Open WebUI'));
  if (has('openwebui-pipelines')) targets.push(lifecycleUpdate('openwebui-pipelines', '🪈 Pipelines'));
  if (has('hermes'))              targets.push(lifecycleUpdate('hermes', '🧠 Hermes'));

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
    .argument('[components...]', 'Component ids to update (omit to update all)')
    .description('Update Eve organs. Pass component ids as args (e.g. `eve update openwebui`) or no args for all. Delegates to @eve/lifecycle so behavior matches the dashboard.')
    .option('--only <organs>', 'Comma-separated organs to update (deprecated — use positional args)')
    .option('--skip <organs>', 'Comma-separated organs to skip, e.g. traefik')
    .action(async (components: string[] | undefined, opts: { only?: string; skip?: string }) => {
      // Use findPodDeployDir() — the canonical resolver used everywhere else
      // (preflight, doctor, lifecycle). It checks SYNAP_DEPLOY_DIR env var
      // first, then walks candidate paths including /opt/synap-backend/deploy
      // and /opt/synap-backend. The old hardcoded list missed the deploy/
      // subdirectory layout and couldn't be overridden without changing code.
      const deployDir = findPodDeployDir() ?? undefined;

      const targets = await buildUpdateTargets(deployDir);

      // Positional args take precedence over `--only`. If the user passes
      // both, positional wins (more specific intent).
      const positionalSet = components && components.length > 0
        ? new Set(components)
        : null;
      const only = positionalSet
        ?? (opts.only ? new Set(opts.only.split(',').map(s => s.trim())) : null);
      const skip = opts.skip ? new Set(opts.skip.split(',').map(s => s.trim())) : new Set<string>();

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
    .description('Full cleanup + full recreation (remove stale Docker data and rebuild stack)')
    .option('--no-prune', 'Skip docker system prune')
    .action(async (opts: { prune?: boolean }) => {
      try {
        console.log(colors.error.bold('\n⚠️  Dangerous operation: full cleanup + recreation\n'));
        console.log('This command will:');
        console.log('  - stop and remove all compose resources in the current directory');
        console.log('  - remove project volumes (data loss)');
        if (opts.prune !== false) {
          console.log('  - prune stale Docker containers/images/volumes/networks');
        }
        console.log('');

        const confirmed = await confirmDestructiveReset();
        if (!confirmed) {
          printInfo('Cancelled.');
          return;
        }

        printInfo('Stopping stack and removing compose resources...');
        await execa('docker', ['compose', 'down', '--volumes', '--remove-orphans'], { stdio: 'inherit' });

        if (opts.prune !== false) {
          printInfo('Pruning stale Docker resources...');
          await execa('docker', ['system', 'prune', '-a', '-f', '--volumes'], { stdio: 'inherit' });
        }

        printInfo('Recreating stack...');
        await execa('docker', ['compose', 'up', '-d'], { stdio: 'inherit' });
        printInfo('Done. Stack recreated from clean state.');
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
      const knownIds = ['synap', 'ollama', 'openclaw', 'rsshub', 'traefik', 'openwebui', 'openwebui-pipelines', 'hermes'];

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
