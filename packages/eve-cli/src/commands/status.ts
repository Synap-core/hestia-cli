import { Command } from 'commander';
import Table from 'cli-table3';
import { entityStateManager, type Organ } from '@eve/dna';
import { getGlobalCliFlags } from '@eve/cli-kit';
import {
  colors,
  emojis,
  printKeyValue,
  formatOrgan,
  printBox,
} from '../lib/ui.js';

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
      colors.primary.bold('Version'),
      colors.primary.bold('Last Check'),
    ],
    colWidths: [15, 12, 12, 25],
    style: {
      head: [],
      border: ['grey'],
    },
  });

  const organs: Organ[] = ['brain', 'arms', 'builder', 'eyes', 'legs'];
  
  for (const organ of organs) {
    const organState = state.organs[organ];
    const statusColor = getStatusColor(organState.state);
    
    table.push([
      formatOrgan(organ),
      statusColor(organState.state),
      organState.version || '-',
      organState.lastChecked 
        ? new Date(organState.lastChecked).toLocaleString()
        : 'Never',
    ]);
  }

  console.log(table.toString());
  console.log();

  // Summary
  const readyCount = organs.filter(o => state.organs[o].state === 'ready').length;
  const percent = Math.round((readyCount / organs.length) * 100);
  
  printBox('Completeness', [
    `${colors.info('Progress:')} ${readyCount}/${organs.length} organs ready (${percent}%)`,
    '',
    getCompletenessBar(percent),
  ]);

  // Next steps
  const missingOrgans = organs.filter(o => state.organs[o].state === 'missing');
  if (missingOrgans.length > 0) {
    console.log();
    console.log(colors.warning.bold(`${emojis.info} Next Steps:`));
    for (const organ of missingOrgans) {
      console.log(`  ${colors.muted('→')} Install ${formatOrgan(organ)}: ${colors.info(`eve ${organ} install`)}`);
    }
  }
  console.log();
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
