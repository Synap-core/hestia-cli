import { Command } from 'commander';
import { execa } from 'execa';
import { execSync, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { getGlobalCliFlags } from '@eve/cli-kit';
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
  update: () => Promise<void>;
}

function buildUpdateTargets(deployDir: string | undefined): UpdateTarget[] {
  const targets: UpdateTarget[] = [];

  // 1. Synap Data Pod (brain)
  if (deployDir) {
    targets.push({
      id: 'synap',
      label: '🧠 Synap Data Pod',
      update: async () => {
        const env = { ...process.env, COMPOSE_PROJECT_NAME: 'synap-backend' };
        await execa('docker', ['compose', 'pull', 'backend', 'realtime', '--ignore-pull-failures'], { cwd: deployDir, env, stdio: 'inherit' });
        await execa('docker', ['compose', 'run', '--rm', 'backend-migrate'], { cwd: deployDir, env, stdio: 'inherit' });
        await execa('docker', ['compose', 'up', '-d', '--no-deps', 'backend', 'realtime'], { cwd: deployDir, env, stdio: 'inherit' });
        // Reconnect to eve-network (container gets recreated)
        const name = getSynapBackendContainer();
        if (name) connectToEveNetwork(name);
      },
    });
  }

  // 2. Ollama (brain - AI)
  targets.push({
    id: 'ollama',
    label: '🤖 Ollama',
    update: async () => {
      spawnSync('docker', ['pull', 'ollama/ollama:latest'], { stdio: 'inherit' });
      spawnSync('docker', ['restart', 'eve-brain-ollama'], { stdio: 'inherit' });
    },
  });

  // 3. OpenClaw (arms)
  targets.push({
    id: 'openclaw',
    label: '🦾 OpenClaw',
    update: async () => {
      spawnSync('docker', ['pull', 'ghcr.io/openclaw/openclaw:latest'], { stdio: 'inherit' });
      spawnSync('docker', ['restart', 'eve-arms-openclaw'], { stdio: 'inherit' });
    },
  });

  // 4. RSSHub (eyes)
  targets.push({
    id: 'rsshub',
    label: '👁️  RSSHub',
    update: async () => {
      spawnSync('docker', ['pull', 'diygod/rsshub:latest'], { stdio: 'inherit' });
      spawnSync('docker', ['restart', 'eve-eyes-rsshub'], { stdio: 'inherit' });
    },
  });

  // 5. Traefik (legs)
  targets.push({
    id: 'traefik',
    label: '🦿 Traefik',
    update: async () => {
      spawnSync('docker', ['pull', 'traefik:v3.0'], { stdio: 'inherit' });
      spawnSync('docker', ['restart', 'eve-legs-traefik'], { stdio: 'inherit' });
      // Reconnect synap to eve-network — Traefik restart doesn't affect other containers
      const name = getSynapBackendContainer();
      if (name) connectToEveNetwork(name);
    },
  });

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
          .filter((n) => n.includes('eve') || n.includes('ollama') || n.includes('synap'));
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
    .description('Pull latest images and restart all Eve organs (Synap, Ollama, OpenClaw, RSSHub, Traefik)')
    .option('--only <organs>', 'Comma-separated organs to update, e.g. synap,ollama')
    .option('--skip <organs>', 'Comma-separated organs to skip, e.g. traefik')
    .action(async (opts: { only?: string; skip?: string }) => {
      const deployDirs = ['/opt/synap-backend', process.env.SYNAP_DEPLOY_DIR].filter(Boolean) as string[];
      const deployDir = deployDirs.find(d => existsSync(join(d, 'docker-compose.yml')));

      const targets = buildUpdateTargets(deployDir);

      const only = opts.only ? new Set(opts.only.split(',').map(s => s.trim())) : null;
      const skip = opts.skip ? new Set(opts.skip.split(',').map(s => s.trim())) : new Set<string>();

      const toUpdate = targets.filter(t =>
        (!only || only.has(t.id)) && !skip.has(t.id),
      );

      console.log();
      console.log(colors.primary.bold('Eve Update'));
      console.log(colors.muted('─'.repeat(50)));

      const results: { label: string; ok: boolean; msg?: string }[] = [];

      for (const target of toUpdate) {
        const spinner = createSpinner(`Updating ${target.label}...`);
        spinner.start();
        try {
          await target.update();
          spinner.succeed(`${target.label} updated`);
          results.push({ label: target.label, ok: true });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          spinner.warn(`${target.label} — skipped (${msg.split('\n')[0]})`);
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
}
