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
  readSynapEnvValue,
} from '@eve/dna';
import { uninstallDashboardContainer } from '@eve/legs';
import { materializeTargets } from '@eve/lifecycle';
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
      // The pod's PINNED compose project — never compose's directory-name
      // default ("deploy"), which would act on a different, empty stack.
      const project = readSynapEnvValue(join(deployDir, '.env'), 'COMPOSE_PROJECT_NAME');
      if (!project) {
        throw new Error(
          `No COMPOSE_PROJECT_NAME pin in ${deployDir}/.env — refusing to guess which stack to stop. ` +
          'Run `synap doctor` on the host (one `synap update` pins it).',
        );
      }
      // Use array args — no shell string interpolation. Volumes are KEPT:
      // they are the pod's database and files (same rule as @eve/lifecycle's
      // removeOne; deleting them is `eve purge`, which asks first).
      await execa('docker', ['compose', '-p', project, '-f', composePath, 'down'], {
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

async function removeNango(): Promise<void> {
  const spinner = createSpinner('Stopping Nango...');
  spinner.start();
  try {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execFileAsync = promisify(execFile);
    await execFileAsync('docker', ['rm', '-f', 'eve-arms-nango'], { timeout: 10_000 });
  } catch {
    // Container already gone — fine
  }
  spinner.succeed('Nango stopped and removed');
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

async function removeOpenwebuiPipelines(): Promise<void> {
  const spinner = createSpinner('Stopping Open WebUI Pipelines sidecar...');
  spinner.start();
  try {
    const { existsSync } = await import('node:fs');
    const deployDir = '/opt/openwebui-pipelines';
    const composePath = join(deployDir, 'docker-compose.yml');

    if (existsSync(composePath)) {
      await execa('docker', ['compose', 'down', '--volumes'], {
        cwd: deployDir,
        stdio: 'inherit',
      });
    } else {
      const { stdout } = await execa('docker', ['ps', '-aq', '-f', 'name=eve-openwebui-pipelines']);
      if (stdout.trim()) {
        const containers = stdout.trim().split('\n').filter(Boolean);
        await execa('docker', ['rm', '-f', ...containers], { stdio: 'inherit' });
      }
    }

    // Best-effort: strip the pipelines wiring block from openwebui's .env so
    // it stops trying to call us on next restart.
    const owEnv = '/opt/openwebui/.env';
    if (existsSync(owEnv)) {
      const { readFileSync, writeFileSync } = await import('node:fs');
      const cur = readFileSync(owEnv, 'utf-8');
      const marker = '# Pipelines wiring — managed by eve add openwebui-pipelines';
      if (cur.includes(marker)) {
        const stripped = cur.split(marker)[0].trimEnd();
        writeFileSync(owEnv, stripped + '\n', { mode: 0o600 });
      }
    }
  } catch {
    printWarning('Pipelines removal failed — check manually.');
  }
  spinner.succeed('Open WebUI Pipelines removed');
}

async function removeDashboard(): Promise<void> {
  const spinner = createSpinner('Stopping Eve Dashboard...');
  spinner.start();
  try {
    uninstallDashboardContainer();
  } catch {
    printWarning('Eve Dashboard removal failed — check `docker ps -a` manually.');
  }
  spinner.succeed('Eve Dashboard removed');
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
      await execa('docker', ['compose', 'down', '--volumes'], {
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

/**
 * Remove FreeLLMAPI.
 *
 * Two deliberate departures from the other remove paths:
 *
 * 1. The named volume is KEPT (`down` WITHOUT `--volumes`). It holds every
 *    upstream free-tier key the user added, encrypted at rest. Those keys were
 *    collected by hand across dozens of provider signups, and a `remove` that
 *    silently destroys them is not recoverable by reinstalling. The command
 *    prints how to purge it deliberately.
 * 2. The pod's provider row is DISABLED first. Leaving it enabled points the
 *    Intelligence Service's cascade at a container that no longer exists —
 *    which surfaces later as slow, confusing failover rather than as
 *    "the thing you removed is gone".
 */
async function removeFreellmapi(): Promise<void> {
  const spinner = createSpinner('Stopping FreeLLMAPI...');
  spinner.start();
  let podNotice: string | null = null;

  // Disable on the pod BEFORE tearing the container down.
  try {
    const { readEveSecrets, resolveSynapUrl, readAgentKeyOrLegacy, setPodProviderEnabled, describePodProviderResult } =
      await import('@eve/dna');
    const secrets = await readEveSecrets(process.cwd());
    const podUrl = resolveSynapUrl(secrets);
    const apiKey = await readAgentKeyOrLegacy('eve', process.cwd());
    if (podUrl && apiKey) {
      const result = await setPodProviderEnabled(podUrl, apiKey, 'freellmapi', false);
      // The spinner has no stop(); report the outcome after it finishes below.
      podNotice = describePodProviderResult(result);
    }
  } catch {
    // Non-fatal: the container teardown below is the point of this command.
    printWarning('Could not disable the freellmapi provider on the pod — do it manually.');
  }

  try {
    const { existsSync } = await import('node:fs');
    const deployDir = '/opt/freellmapi';
    const composePath = join(deployDir, 'docker-compose.yml');

    if (existsSync(composePath)) {
      // NOTE: no `--volumes` — see the docblock.
      await execa('docker', ['compose', 'down'], { cwd: deployDir, stdio: 'inherit' });
    } else {
      const { stdout } = await execa('docker', ['ps', '-aq', '-f', 'name=eve-brain-freellmapi']);
      if (stdout.trim()) {
        const containers = stdout.trim().split('\n').filter(Boolean);
        await execa('docker', ['rm', '-f', ...containers], { stdio: 'inherit' });
      }
    }
  } catch {
    printWarning('FreeLLMAPI removal failed — check manually.');
  }
  spinner.succeed('FreeLLMAPI removed (provider keys kept)');
  if (podNotice) console.log('  ' + podNotice);
  printInfo('  Its stored provider keys were KEPT in the `freellmapi-data` volume.');
  printInfo('  To destroy them too: docker volume rm freellmapi_freellmapi-data');
}

/**
 * Remove OmniRoute. Mirrors `removeFreellmapi`: disable the pod provider FIRST
 * (a running container with a disabled row beats a torn-down one still
 * routed), then tear down the container — and never the volume, because that
 * holds the gateway's SQLite store AND the auto-generated JWT /
 * storage-encryption / API secrets. Regenerating those invalidates every key
 * issued against the instance.
 */
async function removeOmniRoute(): Promise<void> {
  const spinner = createSpinner('Stopping OmniRoute...');
  spinner.start();
  let podNotice: string | null = null;

  try {
    const { readEveSecrets, resolveSynapUrl, readAgentKeyOrLegacy, setPodProviderEnabled, describePodProviderResult } =
      await import('@eve/dna');
    const secrets = await readEveSecrets(process.cwd());
    const podUrl = resolveSynapUrl(secrets);
    const apiKey = await readAgentKeyOrLegacy('eve', process.cwd());
    if (podUrl && apiKey) {
      const result = await setPodProviderEnabled(podUrl, apiKey, 'omniroute', false);
      podNotice = describePodProviderResult(result);
    }
  } catch {
    printWarning('Could not disable the omniroute provider on the pod — do it manually.');
  }

  try {
    const { existsSync } = await import('node:fs');
    const deployDir = '/opt/omniroute';
    const composePath = join(deployDir, 'docker-compose.yml');

    if (existsSync(composePath)) {
      // NOTE: no `--volumes` — the volume holds every registered key.
      await execa('docker', ['compose', 'down'], { cwd: deployDir, stdio: 'inherit' });
    } else {
      const { stdout } = await execa('docker', ['ps', '-aq', '-f', 'name=eve-brain-omniroute']);
      if (stdout.trim()) {
        const containers = stdout.trim().split('\n').filter(Boolean);
        await execa('docker', ['rm', '-f', ...containers], { stdio: 'inherit' });
      }
    }
  } catch {
    printWarning('OmniRoute removal failed — check manually.');
  }
  spinner.succeed('OmniRoute removed (keys kept)');
  if (podNotice) console.log('  ' + podNotice);
  printInfo('  Its keys and SQLite store were KEPT in the `omniroute-data` volume.');
}

/**
 * Remove Postiz through the lifecycle remove — the one place that knows its
 * compose dir and that its volumes must survive (`KEEP_VOLUMES_ON_REMOVE`).
 * A second inline `compose down` here would be a second copy of that rule, and
 * the copy that forgets it deletes every scheduled post and connected account.
 */
async function removePostiz(): Promise<void> {
  const spinner = createSpinner('Stopping Postiz...');
  spinner.start();
  const { runActionToCompletion } = await import('@eve/lifecycle');
  const result = await runActionToCompletion('postiz', 'remove');
  if (result.ok) {
    spinner.succeed('Postiz removed (data kept)');
  } else {
    spinner.fail('Postiz removal failed — check manually.');
    for (const line of result.logs.slice(-6)) console.log('  ' + line);
    if (result.error) printWarning(`  ${result.error}`);
  }
  printInfo('  Its posts, accounts and uploads were KEPT in the eve-postiz-* volumes.');
  printInfo('  The pod keeps its postiz capability; its calls fail until Postiz is back (eve add postiz).');
}

/**
 * DEPRECATED (Content x Brand W4): Remotion was retired in favour of HyperFrames
 * and is no longer a registered component. This standalone path exists for ONE
 * release so pods that installed it can still clean up; it deliberately depends
 * on nothing from the component registry. Delete it once no pod has the
 * `eve-builder-remotion` container. `/opt/remotion` (the operator's project) is
 * never touched.
 */
async function removeLegacyRemotion(): Promise<void> {
  printWarning('Remotion is retired (video is HyperFrames-first) - cleaning up the old renderer.');
  const spinner = createSpinner('Stopping Remotion renderer...');
  spinner.start();
  try {
    const { stdout } = await execa('docker', ['ps', '-aq', '-f', 'name=eve-builder-remotion']);
    const containers = stdout.trim().split('\n').filter(Boolean);
    if (containers.length > 0) {
      await execa('docker', ['rm', '-f', ...containers], { stdio: 'inherit' });
    }
    // Best effort: the image is built on the pod and is unused once the container is gone.
    await execa('docker', ['image', 'rm', 'remotion-renderer:local']).catch(() => undefined);
  } catch {
    spinner.fail('Remotion removal failed');
    printWarning('Check manually: docker rm -f eve-builder-remotion');
    process.exitCode = 1; // a failed removal must not exit 0
    return;
  }
  // Drop the retired component from entity state so `eve status` stops listing it.
  try {
    await entityStateManager.updateComponentEntry('remotion', { state: 'missing' });
    const current = await entityStateManager.getInstalledComponents();
    await entityStateManager.updateSetupProfile({
      components: current.filter((id) => id !== 'remotion'),
    });
  } catch {
    // State may never have held it; the container is what matters.
  }
  spinner.succeed('Remotion removed');
  printInfo('  Your compositions in /opt/remotion were KEPT - delete that directory yourself if unwanted.');
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
  // Eve dashboard is the UI itself — refuse removal
  if (componentId === 'eve-dashboard') {
    printError('Eve Dashboard is always-installed infrastructure and cannot be removed.');
    printInfo('  To stop it temporarily: docker stop eve-dashboard');
    process.exit(1);
  }

  // Retired component: not in the registry, so it must be handled before resolveComponent.
  if (componentId === 'remotion') {
    await removeLegacyRemotion();
    return;
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
  const [refresh] = await materializeTargets(null, ['traefik-routes']);
  if (refresh?.changed) {
    printInfo(refresh.summary);
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
    case 'nango':
      return removeNango;
    case 'rsshub':
      return removeRsshub;
    case 'openwebui':
      return removeOpenwebui;
    case 'omniroute':
      return removeOmniRoute;
    case 'freellmapi':
      return removeFreellmapi;
    case 'postiz':
      return removePostiz;
    case 'openwebui-pipelines':
      return removeOpenwebuiPipelines;
    case 'eve-dashboard':
      return removeDashboard;
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
    hermes: 'arms',
    nango: 'arms',
    postiz: 'arms',
    rsshub: 'eyes',
    traefik: 'legs',
    openwebui: 'eyes',
    'openwebui-pipelines': 'eyes',
    dokploy: 'builder',
    opencode: 'builder',
    openclaude: 'builder',
    'eve-dashboard': 'legs',
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
