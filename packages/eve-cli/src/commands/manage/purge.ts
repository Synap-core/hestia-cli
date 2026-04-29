/**
 * `eve purge` — wipe everything Eve manages so you can start from scratch.
 *
 * Removes in order:
 *   1. Eve-managed Docker containers (by name pattern)
 *   2. Synap backend Docker stack (compose down --volumes)
 *   3. Eve Docker volumes (matching eve/synap/ollama/openwebui/librechat patterns)
 *   4. Eve Docker networks (eve-network, hestia-network)
 *   5. Eve state files (~/.local/share/eve/, ~/.eve/)
 *   6. Deploy directories (/opt/synap-backend, /opt/openwebui, /opt/librechat)
 *   7. Optional: docker system prune -a (removes all unused images)
 *
 * The Eve CLI installation itself (/opt/eve) is NOT removed — use --self to include it.
 */

import type { Command } from 'commander';
import { execSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { execa } from 'execa';
import { getGlobalCliFlags } from '@eve/cli-kit';
import {
  colors,
  printInfo,
  printSuccess,
  printWarning,
  printError,
  createSpinner,
} from '../../lib/ui.js';

// ---------------------------------------------------------------------------
// Container / volume / network patterns
// ---------------------------------------------------------------------------

/** Name prefixes for Eve-managed containers */
const CONTAINER_PREFIXES = [
  'eve-brain-',
  'eve-arms-',
  'eve-eyes-',
  'eve-legs-',
  'eve-builder-',
  'hestia-',
  'synap-backend-',
];

/** Volume name substrings to match */
const VOLUME_PATTERNS = ['eve', 'synap', 'ollama', 'openwebui', 'librechat'];

/** Networks created by Eve */
const NETWORKS = ['eve-network', 'hestia-network'];

/** Optional deploy directories to remove */
const DEPLOY_DIRS = [
  '/opt/synap-backend',
  '/opt/openwebui',
  '/opt/librechat',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function listEveContainers(): string[] {
  try {
    const out = execSync('docker ps -a --format "{{.Names}}"', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();
    return out
      .split('\n')
      .map(n => n.trim())
      .filter(n => n && CONTAINER_PREFIXES.some(prefix => n.startsWith(prefix)));
  } catch {
    return [];
  }
}

function listEveVolumes(): string[] {
  try {
    const out = execSync('docker volume ls --format "{{.Name}}"', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();
    return out
      .split('\n')
      .map(n => n.trim())
      .filter(n => n && VOLUME_PATTERNS.some(p => n.includes(p)));
  } catch {
    return [];
  }
}

function listEveNetworks(): string[] {
  try {
    const out = execSync('docker network ls --format "{{.Name}}"', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();
    return out
      .split('\n')
      .map(n => n.trim())
      .filter(n => NETWORKS.includes(n));
  } catch {
    return [];
  }
}

async function confirmPhrase(phrase: string): Promise<boolean> {
  const flags = getGlobalCliFlags();
  if (flags.nonInteractive) return true;
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question(`  Type "${phrase}" to confirm: `);
    return answer.trim() === phrase;
  } finally {
    rl.close();
  }
}

// ---------------------------------------------------------------------------
// Purge implementation
// ---------------------------------------------------------------------------

export interface PurgeOptions {
  /** Also run docker system prune -a to remove all unused images */
  images?: boolean;
  /** Also remove the Eve CLI installation directory (default: /opt/eve) */
  self?: boolean;
  /** Skip the confirmation prompt */
  yes?: boolean;
  /** Eve install dir (only used when --self) */
  eveDir?: string;
}

export async function runPurge(opts: PurgeOptions = {}): Promise<void> {
  const flags = getGlobalCliFlags();
  const nonInteractive = Boolean(flags.nonInteractive) || Boolean(opts.yes);

  // -----------------------------------------------------------------
  // 1. Inventory
  // -----------------------------------------------------------------
  const containers = listEveContainers();
  const volumes = listEveVolumes();
  const networks = listEveNetworks();
  const stateDir = join(homedir(), '.local', 'share', 'eve');
  const skillsDir = join(homedir(), '.eve');
  const deployDirs = DEPLOY_DIRS.filter(d => existsSync(d));
  const eveDir = opts.eveDir ?? '/opt/eve';

  // -----------------------------------------------------------------
  // 2. Show what will be removed
  // -----------------------------------------------------------------
  console.log();
  console.log(colors.error.bold('⚠️  Eve Purge — complete wipe'));
  console.log(colors.muted('─'.repeat(50)));
  console.log();

  if (containers.length > 0) {
    console.log(colors.primary.bold(`Containers (${containers.length}):`));
    for (const c of containers) console.log(`  ${colors.muted('•')} ${c}`);
    console.log();
  }

  if (volumes.length > 0) {
    console.log(colors.primary.bold(`Volumes (${volumes.length}):`));
    for (const v of volumes) console.log(`  ${colors.muted('•')} ${v}`);
    console.log();
  }

  if (networks.length > 0) {
    console.log(colors.primary.bold(`Networks (${networks.length}):`));
    for (const n of networks) console.log(`  ${colors.muted('•')} ${n}`);
    console.log();
  }

  const statePaths: string[] = [];
  if (existsSync(stateDir)) statePaths.push(stateDir);
  if (existsSync(skillsDir)) statePaths.push(skillsDir);
  if (statePaths.length > 0) {
    console.log(colors.primary.bold('State & config files:'));
    for (const p of statePaths) console.log(`  ${colors.muted('•')} ${p}`);
    console.log();
  }

  if (deployDirs.length > 0) {
    console.log(colors.primary.bold('Deploy directories:'));
    for (const d of deployDirs) console.log(`  ${colors.muted('•')} ${d}`);
    console.log();
  }

  if (opts.images) {
    console.log(colors.primary.bold('Docker images:'));
    console.log(`  ${colors.muted('•')} All unused images (docker system prune -a)`);
    console.log();
  }

  if (opts.self && existsSync(eveDir)) {
    console.log(colors.primary.bold('Eve CLI installation:'));
    console.log(`  ${colors.muted('•')} ${eveDir}`);
    console.log();
  }

  const nothingToDo =
    containers.length === 0 &&
    volumes.length === 0 &&
    networks.length === 0 &&
    statePaths.length === 0 &&
    deployDirs.length === 0 &&
    !opts.images &&
    !(opts.self && existsSync(eveDir));

  if (nothingToDo) {
    printInfo('Nothing to purge — environment looks clean.');
    return;
  }

  // -----------------------------------------------------------------
  // 3. Confirmation
  // -----------------------------------------------------------------
  if (!nonInteractive) {
    console.log(colors.warning('This operation is irreversible. All data in the listed volumes will be lost.'));
    console.log();
    const confirmed = await confirmPhrase('purge');
    if (!confirmed) {
      printInfo('Cancelled.');
      return;
    }
    console.log();
  }

  // -----------------------------------------------------------------
  // 4. Stop & remove containers
  // -----------------------------------------------------------------
  if (containers.length > 0) {
    const s = createSpinner(`Removing ${containers.length} container(s)...`);
    s.start();
    try {
      await execa('docker', ['rm', '-f', ...containers], { stdio: 'pipe' });
      s.succeed(`Removed ${containers.length} container(s)`);
    } catch (err) {
      s.warn(`Some containers could not be removed: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`);
    }
  }

  // -----------------------------------------------------------------
  // 5. Tear down Synap backend compose stack (if deploy dir exists)
  // -----------------------------------------------------------------
  const synapDeployDir = ['/opt/synap-backend/deploy', process.env.SYNAP_DEPLOY_DIR]
    .filter(Boolean)
    .find(d => d && existsSync(join(d as string, 'docker-compose.yml')));

  if (synapDeployDir) {
    const s = createSpinner('Tearing down Synap backend compose stack...');
    s.start();
    try {
      await execa('docker', ['compose', 'down', '--volumes', '--remove-orphans'], {
        cwd: synapDeployDir,
        stdio: 'pipe',
      });
      s.succeed('Synap compose stack removed');
    } catch {
      s.warn('Synap compose down failed (stack may already be down)');
    }
  }

  // -----------------------------------------------------------------
  // 6. Remove volumes
  // -----------------------------------------------------------------
  const freshVolumes = listEveVolumes(); // re-query after compose down
  if (freshVolumes.length > 0) {
    const s = createSpinner(`Removing ${freshVolumes.length} volume(s)...`);
    s.start();
    const failed: string[] = [];
    for (const vol of freshVolumes) {
      try {
        await execa('docker', ['volume', 'rm', vol], { stdio: 'pipe' });
      } catch {
        failed.push(vol);
      }
    }
    if (failed.length === 0) {
      s.succeed(`Removed ${freshVolumes.length} volume(s)`);
    } else {
      s.warn(`Removed ${freshVolumes.length - failed.length}/${freshVolumes.length} volumes. In use: ${failed.join(', ')}`);
    }
  }

  // -----------------------------------------------------------------
  // 7. Remove networks
  // -----------------------------------------------------------------
  const freshNetworks = listEveNetworks();
  if (freshNetworks.length > 0) {
    const s = createSpinner('Removing Docker networks...');
    s.start();
    const failed: string[] = [];
    for (const net of freshNetworks) {
      try {
        await execa('docker', ['network', 'rm', net], { stdio: 'pipe' });
      } catch {
        failed.push(net);
      }
    }
    if (failed.length === 0) {
      s.succeed(`Removed networks: ${freshNetworks.join(', ')}`);
    } else {
      s.warn(`Could not remove: ${failed.join(', ')} (containers still attached?)`);
    }
  }

  // -----------------------------------------------------------------
  // 8. Remove state files
  // -----------------------------------------------------------------
  if (existsSync(stateDir)) {
    const s = createSpinner('Removing Eve state files...');
    s.start();
    try {
      rmSync(stateDir, { recursive: true, force: true });
      s.succeed(`Removed ${stateDir}`);
    } catch (err) {
      s.warn(`Could not remove ${stateDir}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (existsSync(skillsDir)) {
    const s = createSpinner('Removing Eve skills & config (~/.eve)...');
    s.start();
    try {
      rmSync(skillsDir, { recursive: true, force: true });
      s.succeed(`Removed ${skillsDir}`);
    } catch (err) {
      s.warn(`Could not remove ${skillsDir}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // -----------------------------------------------------------------
  // 9. Remove deploy directories
  // -----------------------------------------------------------------
  for (const dir of deployDirs) {
    const s = createSpinner(`Removing ${dir}...`);
    s.start();
    try {
      rmSync(dir, { recursive: true, force: true });
      s.succeed(`Removed ${dir}`);
    } catch (err) {
      s.warn(`Could not remove ${dir}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // -----------------------------------------------------------------
  // 10. Optional: docker system prune -a
  // -----------------------------------------------------------------
  if (opts.images) {
    const s = createSpinner('Pruning all unused Docker images...');
    s.start();
    try {
      await execa('docker', ['system', 'prune', '-a', '-f', '--volumes'], { stdio: 'pipe' });
      s.succeed('Docker system pruned (all unused images removed)');
    } catch (err) {
      s.warn(`docker system prune failed: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`);
    }
  }

  // -----------------------------------------------------------------
  // 11. Optional: remove Eve CLI itself
  // -----------------------------------------------------------------
  if (opts.self && existsSync(eveDir)) {
    const s = createSpinner(`Removing Eve CLI installation (${eveDir})...`);
    s.start();
    try {
      rmSync(eveDir, { recursive: true, force: true });
      s.succeed(`Removed ${eveDir}`);
    } catch (err) {
      s.warn(`Could not remove ${eveDir}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // -----------------------------------------------------------------
  // Done
  // -----------------------------------------------------------------
  console.log();
  printSuccess('Purge complete. Your server is clean.');
  console.log();
  if (!opts.self) {
    printInfo('Eve CLI is still installed. To reinstall from scratch:');
    printInfo('  eve install');
    console.log();
  }
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function purgeCommand(program: Command): void {
  program
    .command('purge')
    .description('Remove all Eve containers, volumes, networks, and state — clean slate for reinstall')
    .option('--images', 'Also remove all unused Docker images (docker system prune -a)')
    .option('--self', 'Also remove the Eve CLI installation directory (/opt/eve)')
    .option('--eve-dir <path>', 'Eve install directory (default: /opt/eve, only with --self)')
    .addHelpText('after', `
Examples:
  eve purge                  # Remove containers, volumes, networks, state files
  eve purge --images         # Also wipe all Docker image cache
  eve purge --self           # Also remove /opt/eve (use when decommissioning the server)
  eve --yes purge            # Non-interactive (skip confirmation prompt)

What is NOT removed by default:
  /opt/eve                   # Eve CLI itself (use --self to include)
  Docker images              # Pulled images stay cached (use --images to wipe)
  Other Docker resources     # Only resources matching Eve naming patterns are removed
`)
    .action(async (opts: { images?: boolean; self?: boolean; eveDir?: string }) => {
      try {
        await runPurge(opts);
      } catch (err) {
        printError(`Purge failed: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });
}
