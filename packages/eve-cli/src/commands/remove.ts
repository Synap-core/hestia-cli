/**
 * `eve remove <component>` — remove a component from an existing entity.
 *
 * Reads current state, validates the component exists, stops/removes Docker
 * resources, updates state.json and setup-profile.json.
 */

import type { Command } from 'commander';
import { execa } from 'execa';
import { join } from 'node:path';
import { confirm, isCancel } from '@clack/prompts';
import { getGlobalCliFlags, } from '@eve/cli-kit';
import {
  entityStateManager,
} from '@eve/dna';
import { refreshTraefikRoutes } from '@eve/legs';
import {
  colors,
  emojis,
  printHeader,
  printSuccess,
  printError,
  printInfo,
  printWarning,
  createSpinner,
} from '../lib/ui.js';
import {
  COMPONENTS,
  resolveComponent,
} from '../lib/components.js';

// ---------------------------------------------------------------------------
// Component-specific remove implementations
// ---------------------------------------------------------------------------

async function removeTraefik(): Promise<void> {
  const spinner = createSpinner('Stopping Traefik...');
  spinner.start();
  try {
    // Try docker compose down for the legs project
    await execa('docker', ['compose', 'down', '--volumes'], {
      cwd: join(process.cwd(), '.eve', 'traefik'),
      stdio: 'inherit',
    });
  } catch {
    // Fallback: try docker ps filtering by name
    try {
      const { stdout } = await execa('docker', ['ps', '-q', '-f', 'name=eve-traefik']);
      if (stdout.trim()) {
        const containers = stdout.trim().split('\n').filter(Boolean);
        await execa('docker', ['rm', '-f', ...containers], { stdio: 'inherit' });
      }
    } catch {
      // Non-fatal: traefik might be managed externally
    }
  }
  spinner.succeed('Traefik stopped');
}

async function removeSynap(): Promise<void> {
  const spinner = createSpinner('Stopping Synap Data Pod...');
  spinner.start();
  try {
    const deployDir = process.env.SYNAP_DEPLOY_DIR;
    if (deployDir) {
      const composePath = join(deployDir, 'docker-compose.yml');
      // Use array args — no shell string interpolation
      await execa('docker', ['compose', '-f', composePath, 'down', '--volumes'], {
        env: { ...process.env, SYNAP_ASSUME_YES: '1' },
        stdio: 'inherit',
      });
    } else {
      const { stdout } = await execa('docker', ['ps', '-q', '-f', 'name=eve-synap']);
      if (stdout.trim()) {
        const containers = stdout.trim().split('\n').filter(Boolean);
        await execa('docker', ['rm', '-f', ...containers], { stdio: 'inherit' });
      }
    }
  } catch {
    printWarning('Synap removal failed — check manually.');
  }
  spinner.succeed('Synap stopped');
}

async function removeOllama(): Promise<void> {
  const spinner = createSpinner('Stopping Ollama...');
  spinner.start();
  try {
    const { stdout } = await execa('docker', ['ps', '-q', '-f', 'name=ollama']);
    if (stdout.trim()) {
      const containers = stdout.trim().split('\n').filter(Boolean);
      await execa('docker', ['rm', '-f', ...containers], { stdio: 'inherit' });
    }
  } catch {
    // Non-fatal
  }
  spinner.succeed('Ollama stopped');
}

async function removeOpenclaw(): Promise<void> {
  const spinner = createSpinner('Removing OpenClaw...');
  spinner.start();
  try {
    const synapScript = process.env.SYNAP_SETUP_SCRIPT;
    if (synapScript && process.platform !== 'win32') {
      await execa('bash', [synapScript, 'services', 'remove', 'openclaw'], {
        env: { ...process.env, SYNAP_DEPLOY_DIR: process.env.SYNAP_DEPLOY_DIR || '', SYNAP_ASSUME_YES: '1' },
        stdio: 'inherit',
      });
    } else {
      const { stdout } = await execa('docker', ['ps', '-q', '-f', 'name=openclaw']);
      if (stdout.trim()) {
        const containers = stdout.trim().split('\n').filter(Boolean);
        await execa('docker', ['rm', '-f', ...containers], { stdio: 'inherit' });
      }
    }
  } catch {
    printWarning('OpenClaw removal failed — check manually.');
  }
  spinner.succeed('OpenClaw removed');
}

async function removeRsshub(): Promise<void> {
  const spinner = createSpinner('Removing RSSHub...');
  spinner.start();
  try {
    const { stdout } = await execa('docker', ['ps', '-q', '-f', 'name=rsshub']);
    if (stdout.trim()) {
      const containers = stdout.trim().split('\n').filter(Boolean);
      await execa('docker', ['rm', '-f', ...containers], { stdio: 'inherit' });
    }
    // Also remove RSSHubService managed container
    const { RSSHubService } = await import('@eve/eyes');
    const rsshub = new RSSHubService();
    await rsshub.stop();
  } catch {
    printWarning('RSSHub removal failed — check manually.');
  }
  spinner.succeed('RSSHub removed');
}

async function removeOpenwebui(): Promise<void> {
  const spinner = createSpinner('Stopping Open WebUI...');
  spinner.start();
  try {
    const { existsSync } = await import('node:fs');
    const deployDir = '/opt/openwebui';
    const composePath = join(deployDir, 'docker-compose.yml');

    if (existsSync(composePath)) {
      // Tear down via the same compose project we used to bring it up
      await execa('docker', ['compose', '--profile', 'openwebui', 'down', '--volumes'], {
        cwd: deployDir,
        stdio: 'inherit',
      });
    } else {
      // Fallback: remove by container name
      const { stdout } = await execa('docker', ['ps', '-aq', '-f', 'name=hestia-openwebui']);
      if (stdout.trim()) {
        const containers = stdout.trim().split('\n').filter(Boolean);
        await execa('docker', ['rm', '-f', ...containers], { stdio: 'inherit' });
      }
    }
  } catch {
    printWarning('Open WebUI removal failed — check manually.');
  }
  spinner.succeed('Open WebUI removed');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Remove a component from the current entity.
 */
export async function runRemove(componentId: string): Promise<void> {
  // Traefik is always-installed infrastructure — refuse removal
  if (componentId === 'traefik') {
    printError('Traefik is always-installed infrastructure and cannot be removed.');
    printInfo('  To stop it temporarily: docker stop eve-legs-traefik');
    process.exit(1);
  }

  const comp = resolveComponent(componentId);

  // Check if installed
  const installed = await entityStateManager.isComponentInstalled(componentId);
  if (!installed) {
    // Also check organ state — component may have been installed via old v1 path
    const organ = comp.organ;
    let organReady = false;
    if (organ) {
      const organState = await entityStateManager.getOrganState(organ as Parameters<typeof entityStateManager.getOrganState>[0]);
      organReady = organState.state === 'ready';
    }
    if (!organReady) {
      printWarning(`${comp.label} does not appear to be installed.`);
      printInfo('  Run "eve status" to see current state.');
      return;
    }
  }

  // Check if other components depend on this one
  const currentComponents = await entityStateManager.getInstalledComponents();
  const dependents = currentComponents.filter(dep => {
    const depInfo = COMPONENTS.find(c => c.id === dep);
    return depInfo?.requires?.includes(componentId) ?? false;
  });
  if (dependents.length > 0) {
    const depNames = dependents.map(d => {
      const info = COMPONENTS.find(c => c.id === d);
      return info ? info.label : d;
    });
    printWarning(`${comp.label} is a prerequisite for: ${depNames.join(', ')}`);
    printInfo('  Remove dependents first, or proceed with caution:');
    console.log();
  }

  printHeader(`Removing ${comp.label}`, comp.emoji);
  console.log();
  printInfo('This will stop and remove the Docker containers for this component.');
  console.log();

  // Confirm before destructive action (skip in non-interactive mode)
  const flags = getGlobalCliFlags();
  if (!flags.nonInteractive) {
    const ok = await confirm({ message: `Remove ${comp.label}? This cannot be undone.` });
    if (isCancel(ok) || !ok) {
      console.log(colors.muted('Cancelled.'));
      return;
    }
  }

  // Run the removal
  let removeFn: () => Promise<void>;
  try {
    removeFn = buildRemoveStep(comp.id);
  } catch (err) {
    printError(String(err));
    process.exit(1);
  }

  await removeFn();

  // Update state
  await updateStateAfterRemove(comp.id);

  // Auto-refresh Traefik routes so removed component's subdomain stops returning 502
  const refresh = await refreshTraefikRoutes();
  if (refresh.refreshed) {
    printInfo(`Traefik routes refreshed for ${refresh.domain}`);
  }

  console.log();
  printSuccess(`${comp.label} removed successfully!`);
  console.log();
  printInfo('Next steps:');
  printInfo(`  - Run "eve status" to check entity state`);
  printInfo(`  - Run "eve add ${comp.id}" to add it back later`);
  console.log();
}

// ---------------------------------------------------------------------------
// Step builder
// ---------------------------------------------------------------------------

function buildRemoveStep(componentId: string): () => Promise<void> {
  switch (componentId) {
    case 'traefik':
      return removeTraefik;
    case 'synap':
      return removeSynap;
    case 'ollama':
      return removeOllama;
    case 'openclaw':
      return removeOpenclaw;
    case 'rsshub':
      return removeRsshub;
    case 'openwebui':
      return removeOpenwebui;
    case 'hermes':
    case 'dokploy':
    case 'opencode':
    case 'openclaude':
      return async () => {
        const info = COMPONENTS.find(c => c.id === componentId);
        if (info) {
          printWarning(`${info.label} removal requires manual cleanup.`);
          printInfo('  Run "eve builder stack" to manage builder resources.');
        }
      };
    default:
      throw new Error(`No remove handler for component: ${componentId}`);
  }
}

// ---------------------------------------------------------------------------
// State update
// ---------------------------------------------------------------------------

async function updateStateAfterRemove(componentId: string): Promise<void> {
  const organMap: Record<string, 'brain' | 'arms' | 'builder' | 'eyes' | 'legs'> = {
    synap: 'brain',
    ollama: 'brain',
    openclaw: 'arms',
    hermes: 'builder',
    rsshub: 'eyes',
    traefik: 'legs',
    openwebui: 'eyes',
    dokploy: 'builder',
    opencode: 'builder',
    openclaude: 'builder',
  };

  const organ = organMap[componentId];
  if (organ) {
    await entityStateManager.updateOrgan(organ, 'missing');
  }

  await entityStateManager.updateComponentEntry(componentId, {
    state: 'missing',
  });

  // Remove from setup profile v2 components list
  const current = await entityStateManager.getInstalledComponents();
  const updated = current.filter(id => id !== componentId);
  if (updated.length === 0) {
    // If no components left, reset to minimal
    await entityStateManager.updateSetupProfile({ components: ['traefik'] });
    await entityStateManager.updateComponentEntry('traefik', { state: 'ready' });
    await entityStateManager.updateOrgan('legs', 'ready', { version: '0.1.0' });
  } else {
    await entityStateManager.updateSetupProfile({ components: updated });
  }
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

export function removeCommand(program: Command): void {
  program
    .command('remove')
    .alias('rm')
    .description('Remove a component from an existing entity')
    .argument('[component]', 'Component ID to remove (synap, ollama, openclaw, rsshub, traefik, openwebui)')
    .action(async (component: string | undefined) => {
      if (!component) {
        console.log();
        printHeader('Eve — Remove Component', emojis.entity);
        console.log();
        printInfo('Usage: eve remove <component>');
        console.log();
        printInfo('Available components:');
        for (const comp of COMPONENTS) {
          const installed = await entityStateManager.isComponentInstalled(comp.id);
          const tag = installed
            ? colors.success(' [installed]')
            : ((await entityStateManager.getOrganState(comp.organ! as Parameters<typeof entityStateManager.getOrganState>[0])).state === 'ready')
              ? colors.success(' [installed]')
              : colors.muted('[not installed]');
          console.log(`  ${comp.emoji} ${colors.primary.bold(comp.label)}${tag}`);
          console.log(`    ${comp.description.split('\n')[0]}`);
        }
        console.log();
        printWarning('Warning: traefik cannot be removed (always installed).');
        printInfo('Examples:');
        printInfo('  eve remove ollama             # Remove local AI inference');
        printInfo('  eve remove openclaw           # Remove AI agent layer');
        printInfo('  eve remove rsshub             # Remove data perception');
        console.log();
        return;
      }

      await runRemove(component);
    });
}

// ---------------------------------------------------------------------------
// Import helper for dynamic imports
// ---------------------------------------------------------------------------

// no-op — import helper removed (not used at runtime)
