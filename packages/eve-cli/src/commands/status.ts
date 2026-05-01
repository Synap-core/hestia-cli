import { Command } from 'commander';
import Table from 'cli-table3';
import { execSync } from 'child_process';
import { entityStateManager, type Organ, COMPONENTS } from '@eve/dna';
import { getGlobalCliFlags } from '@eve/cli-kit';
import {
  colors,
  emojis,
  printKeyValue,
  formatOrgan,
  printBox,
} from '../lib/ui.js';

// 'eve-brain-synap-proxy' is a synthetic alias resolved via docker label lookup
// in getLiveContainerState() — the real container is synap-backend-backend-1.
const ORGAN_CONTAINERS: Record<Organ, string[]> = {
  brain:   ['eve-brain-synap-proxy', 'eve-brain-ollama'],
  arms:    ['eve-arms-openclaw'],
  builder: [],
  eyes:    ['eve-eyes-rsshub'],
  legs:    ['eve-legs-traefik'],
};

interface LiveContainerState {
  running: Set<string>;
  all: Set<string>;
}

function getLiveContainerState(): LiveContainerState {
  const running = new Set<string>();
  const all = new Set<string>();
  try {
    const outRunning = execSync('docker ps --format "{{.Names}}"', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();
    for (const n of outRunning.split('\n').filter(Boolean)) running.add(n.trim());
  } catch {}
  try {
    const outAll = execSync('docker ps -a --format "{{.Names}}"', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();
    for (const n of outAll.split('\n').filter(Boolean)) all.add(n.trim());
  } catch {}
  // Also detect synap-backend containers (different naming from synap compose)
  try {
    const synapName = execSync(
      `docker ps --filter "label=com.docker.compose.project=synap-backend" --filter "label=com.docker.compose.service=backend" --format "{{.Names}}"`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] },
    ).trim().split('\n')[0]?.trim();
    if (synapName) running.add('eve-brain-synap-proxy');
  } catch {}
  try {
    const synapNameAll = execSync(
      `docker ps -a --filter "label=com.docker.compose.project=synap-backend" --filter "label=com.docker.compose.service=backend" --format "{{.Names}}"`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] },
    ).trim().split('\n')[0]?.trim();
    if (synapNameAll) all.add('eve-brain-synap-proxy');
  } catch {}
  return { running, all };
}

function getOrganLiveState(organ: Organ, state: LiveContainerState): 'running' | 'partial' | 'stopped' | 'not-installed' | 'unknown' {
  const containers = ORGAN_CONTAINERS[organ];
  if (containers.length === 0) return 'unknown';
  const runningCount = containers.filter(c => state.running.has(c)).length;
  if (runningCount === containers.length) return 'running';
  if (runningCount > 0) return 'partial';
  const existsCount = containers.filter(c => state.all.has(c)).length;
  if (existsCount === 0) return 'not-installed';
  return 'stopped';
}

export function statusCommand(program: Command): void {
  program
    .command('status')
    .alias('s')
    .description('Show comprehensive entity status')
    .option('-w, --watch', 'Watch mode - continuously update')
    .option('-j, --json', 'Output as JSON')
    .action(async (options) => {
      try {
        if (options.watch) {
          await watchStatus();
        } else {
          await showStatus(Boolean(options.json || getGlobalCliFlags().json));
        }
      } catch (error) {
        console.error(colors.error('Failed to get entity status:'), error);
        process.exit(1);
      }
    });
}

async function showStatus(json = false): Promise<void> {
  const state = await entityStateManager.getState();

  if (json) {
    console.log(JSON.stringify(state, null, 2));
    return;
  }

  const liveContainers = getLiveContainerState();

  // Header
  console.log();
  console.log(colors.primary.bold(`${emojis.entity} Entity Status`));
  console.log(colors.primary('═'.repeat(50)));
  console.log();

  // Entity Info
  printKeyValue('Entity Name', state.metadata.entityName || 'Unnamed');
  printKeyValue('Version', state.version);
  printKeyValue('Initialized', new Date(state.initializedAt).toLocaleDateString());
  printKeyValue('AI Model', state.aiModel === 'none' ? 'Not configured' : state.aiModel);

  if (state.metadata.lastBootTime) {
    printKeyValue('Last Boot', new Date(state.metadata.lastBootTime).toLocaleString());
  }
  console.log();

  // Organ Status Table
  const table = new Table({
    head: [
      colors.primary.bold('Organ'),
      colors.primary.bold('Status'),
      colors.primary.bold('Live'),
      colors.primary.bold('Version'),
      colors.primary.bold('Last Check'),
    ],
    colWidths: [15, 12, 10, 12, 22],
    style: {
      head: [],
      border: ['grey'],
    },
  });

  const organs: Organ[] = ['brain', 'arms', 'builder', 'eyes', 'legs'];

  for (const organ of organs) {
    const organState = state.organs[organ];
    const statusColor = getStatusColor(organState.state);
    const liveState = getOrganLiveState(organ, liveContainers);

    let liveLabel: string;
    if (liveState === 'running') liveLabel = colors.success('● up');
    else if (liveState === 'partial') liveLabel = colors.warning('◑ partial');
    else if (liveState === 'stopped') liveLabel = colors.error('○ down');
    else if (liveState === 'not-installed') liveLabel = colors.muted('✗ none');
    else liveLabel = colors.muted('—');

    table.push([
      formatOrgan(organ),
      statusColor(organState.state),
      liveLabel,
      organState.version || '-',
      organState.lastChecked
        ? new Date(organState.lastChecked).toLocaleString()
        : 'Never',
    ]);
  }

  console.log(table.toString());
  console.log();

  // Component-Level View (v2 installed map)
  const components = state.installed;
  if (components && Object.keys(components).length > 0) {
    const compTable = new Table({
      head: [
        colors.primary.bold('Component'),
        colors.primary.bold('Status'),
        colors.primary.bold('Version'),
        colors.primary.bold('Managed By'),
      ],
      colWidths: [18, 12, 12, 14],
      style: {
        head: [],
        border: ['grey'],
      },
    });

    const COMPONENT_LABELS: Record<string, string> = {
      synap: 'Synap',
      openclaw: 'OpenClaw',
      hermes: 'Hermes',
      rsshub: 'RSSHub',
      traefik: 'Traefik',
      ollama: 'Ollama',
      openwebui: 'Open WebUI',
    };

    for (const [id, comp] of Object.entries(components)) {
      const statusColor = getStatusColor(comp.state);
      const managedByColor = comp.managedBy === 'eve'
        ? colors.success
        : comp.managedBy === 'synap'
          ? colors.warning
          : colors.muted;

      compTable.push([
        COMPONENT_LABELS[id] || id,
        statusColor(comp.state),
        comp.version || '-',
        managedByColor(comp.managedBy || '—'),
      ]);
    }

    console.log(compTable.toString());
    console.log();
  }

  // Summary
  const readyCount = organs.filter(o => state.organs[o].state === 'ready').length;
  const percent = Math.round((readyCount / organs.length) * 100);
  
  printBox('Completeness', [
    `${colors.info('Progress:')} ${readyCount}/${organs.length} organs ready (${percent}%)`,
    '',
    getCompletenessBar(percent),
  ]);

  // Stale-state warning — state.json says ready but containers are down or missing
  const FIX_COMMANDS: Record<Organ, string> = {
    brain:   'npx eve brain init --synap-repo /path/to/synap-backend',
    arms:    'npx eve install --components=arms',
    builder: 'npx eve install --components=builder',
    eyes:    'npx eve install --components=eyes',
    legs:    'npx eve install --components=legs',
  };
  const RESTART_COMMANDS: Record<Organ, string> = {
    brain:   'docker start $(docker ps -a --filter "label=com.docker.compose.project=synap-backend" --filter "label=com.docker.compose.service=backend" -q)',
    arms:    'docker start eve-arms-openclaw',
    builder: 'docker start eve-builder-hermes',
    eyes:    'docker start eve-eyes-rsshub',
    legs:    'docker start eve-legs-traefik',
  };

  const staleOrgans = organs.filter(o => {
    const live = getOrganLiveState(o, liveContainers);
    return state.organs[o].state === 'ready' && (live === 'stopped' || live === 'not-installed');
  });
  const notInstalledOrgans = organs.filter(o =>
    state.organs[o].state === 'ready' && getOrganLiveState(o, liveContainers) === 'not-installed',
  );
  const missingOrgans = organs.filter(o => state.organs[o].state === 'missing');

  if (staleOrgans.length > 0 || missingOrgans.length > 0) {
    console.log();
    console.log(colors.warning.bold(`${emojis.info} Action needed:`));
    for (const organ of staleOrgans) {
      const isNotInstalled = notInstalledOrgans.includes(organ);
      if (isNotInstalled) {
        console.log(`  ${colors.error('✗')} ${formatOrgan(organ)} — never installed or container removed`);
        console.log(`      ${colors.muted('→')} ${colors.info(FIX_COMMANDS[organ])}`);
      } else {
        console.log(`  ${colors.error('○')} ${formatOrgan(organ)} — container stopped`);
        console.log(`      ${colors.muted('→')} ${colors.info(RESTART_COMMANDS[organ])}`);
      }
    }
    for (const organ of missingOrgans) {
      console.log(`  ${colors.muted('→')} Install ${formatOrgan(organ)}: ${colors.info(FIX_COMMANDS[organ])}`);
    }
  }

  // ─── Component overview: installed | recommended | available ────────────
  await showComponentOverview();

  console.log();
}

/**
 * Three-bucket component view: what's installed (with health), what we
 * recommend installing next, what else is available.
 */
async function showComponentOverview(): Promise<void> {
  const installed = await entityStateManager.getInstalledComponents();

  // Bucket components
  const installedComps = COMPONENTS.filter(c => installed.includes(c.id));
  const availableComps = COMPONENTS.filter(c => !installed.includes(c.id));

  // Recommendation logic — opinionated suggestions based on what's already in place
  const recommendations: Array<{ id: string; reason: string }> = [];
  if (installed.includes('synap') && !installed.includes('openclaw')) {
    recommendations.push({ id: 'openclaw', reason: 'gives your data pod an AI agent layer' });
  }
  if (installed.includes('synap') && !installed.includes('rsshub')) {
    recommendations.push({ id: 'rsshub', reason: 'turns websites into feeds your AI can read' });
  }
  if (installed.includes('synap') && !installed.includes('openwebui')) {
    recommendations.push({ id: 'openwebui', reason: 'self-hosted chat UI wired to your AI' });
  }
  if (!installed.includes('synap') && installed.includes('traefik')) {
    recommendations.push({ id: 'synap', reason: 'the data pod — your sovereign second brain' });
  }
  const recommendedIds = new Set(recommendations.map(r => r.id));

  console.log();
  console.log(colors.primary.bold(`${emojis.entity} Components`));
  console.log(colors.muted('─'.repeat(60)));

  // Installed
  if (installedComps.length > 0) {
    console.log();
    console.log(colors.success.bold('  Installed'));
    for (const comp of installedComps) {
      console.log(`    ${colors.success('●')} ${comp.emoji} ${comp.label.padEnd(20)} ${colors.muted(comp.description.split('.')[0])}`);
    }
  }

  // Recommended next
  if (recommendations.length > 0) {
    console.log();
    console.log(colors.warning.bold('  Recommended next'));
    for (const rec of recommendations) {
      const comp = COMPONENTS.find(c => c.id === rec.id)!;
      console.log(`    ${colors.warning('○')} ${comp.emoji} ${comp.label.padEnd(20)} ${colors.muted(rec.reason)}`);
      console.log(`      ${colors.muted('→')} ${colors.info(`eve add ${comp.id}`)}`);
    }
  }

  // Available (excluding already-recommended)
  const otherAvailable = availableComps.filter(c => !recommendedIds.has(c.id));
  if (otherAvailable.length > 0) {
    console.log();
    console.log(colors.muted.bold('  Also available'));
    for (const comp of otherAvailable) {
      const reqs = comp.requires?.length
        ? colors.muted(` (requires: ${comp.requires.join(', ')})`)
        : '';
      console.log(`    ${colors.muted('○')} ${comp.emoji} ${comp.label.padEnd(20)} ${colors.muted(comp.description.split('.')[0])}${reqs}`);
    }
    console.log();
    console.log(colors.muted(`    Install any with: ${colors.info('eve add <component-id>')}`));
  }
}

async function watchStatus(): Promise<void> {
  console.log(colors.info('Watching entity status (press Ctrl+C to exit)...\n'));
  
  // Initial display
  await showStatus();
  
  // Set up interval
  const interval = setInterval(async () => {
    // Clear previous output
    console.log('\x1b[2J\x1b[0f');
    await showStatus();
    console.log(colors.muted('\n(Updating every 2 seconds. Press Ctrl+C to exit)'));
  }, 2000);

  // Handle exit
  process.on('SIGINT', () => {
    clearInterval(interval);
    console.log('\n' + colors.success('Watch mode stopped'));
    process.exit(0);
  });
}

function getStatusColor(state: string): (text: string) => string {
  switch (state) {
    case 'ready':
      return colors.success;
    case 'installing':
      return colors.info;
    case 'error':
      return colors.error;
    case 'stopped':
      return colors.warning;
    default:
      return colors.muted;
  }
}

function getCompletenessBar(percent: number): string {
  const width = 30;
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  let color = colors.error;
  if (percent >= 60) color = colors.warning;
  if (percent >= 80) color = colors.info;
  if (percent === 100) color = colors.success;
  
  return color(bar) + colors.muted(` ${percent}%`);
}
