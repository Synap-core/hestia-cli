import { Command } from 'commander';
import { confirm, select, isCancel } from '@clack/prompts';
import { entityStateManager, type Organ } from '@eve/dna';
import { runAdd } from './add.js';
import {
  colors,
  emojis,
  printHeader,
  printError,
  printInfo,
} from '../lib/ui.js';

export function growCommand(program: Command): void {
  const grow = program
    .command('grow')
    .description('Grow the entity by developing new capabilities')
    .action(async () => {
      await interactiveGrow();
    });

  grow
    .command('organ')
    .description('Add a new organ to the entity')
    .argument('[organ]', 'Organ: brain | arms | builder | eyes | legs')
    .option('--dry-run', 'Print planned steps only (no install)')
    .option('--with-ai', 'When growing brain, include Ollama')
    .action(async (organ: string | undefined, options: { dryRun?: boolean; withAi?: boolean }) => {
      if (organ) {
        await growOrgan(organ, options);
      } else {
        await interactiveGrow();
      }
    });

  grow
    .command('capability')
    .description('Add a new capability to an existing organ')
    .action(async () => {
      await growCapability();
    });
}

async function interactiveGrow(): Promise<void> {
  console.log();
  console.log(colors.primary.bold(`${emojis.sparkles} Eve Entity Growth`));
  console.log();

  const state = await entityStateManager.getState();

  printHeader('Current Entity State', emojis.entity);
  console.log();

  const organs = ['brain', 'arms', 'builder', 'eyes', 'legs'] as const;
  for (const organ of organs) {
    const status = state.organs[organ].state;
    const icon = status === 'ready' ? emojis.check : status === 'missing' ? '○' : '◐';
    const color = status === 'ready' ? colors.success : status === 'missing' ? colors.muted : colors.warning;
    console.log(`  ${color(icon)} ${organ.charAt(0).toUpperCase() + organ.slice(1)}: ${color(status)}`);
  }

  console.log();

  const action = await select({
    message: 'What would you like to grow?',
    options: [
      { value: 'brain', label: '🧠  Brain - Intelligence & Memory', hint: 'Core AI and data services' },
      { value: 'arms', label: '🦾  Arms - Action & Tools', hint: 'AI assistant and MCP servers' },
      { value: 'eyes', label: '👁️  Eyes - Perception', hint: 'RSS feeds and monitoring' },
      { value: 'legs', label: '🦿  Legs - Exposure', hint: 'Traefik and domain routing' },
      { value: 'builder', label: '🏗️  Builder - Creation', hint: 'Development and deployment tools' },
    ],
  });

  if (isCancel(action)) {
    console.log(colors.muted('Cancelled.'));
    return;
  }
  if (typeof action === 'string') {
    let withAi = false;
    if (action === 'brain') {
      const ai = await confirm({
        message: 'Include local AI (Ollama)?',
        initialValue: false,
      });
      if (isCancel(ai)) {
        console.log(colors.muted('Cancelled.'));
        return;
      }
      withAi = Boolean(ai);
    }
    await growOrgan(action, {
      dryRun: false,
      withAi,
    });
  }
}

// Map organ names to component IDs for delegation to `eve add`
const ORGAN_TO_COMPONENT: Record<string, string> = {
  brain: 'synap',
  arms: 'openclaw',
  eyes: 'rsshub',
  legs: 'traefik',
  builder: 'hermes',
};

async function growOrgan(
  organ: string,
  options: { dryRun?: boolean; withAi?: boolean }
): Promise<void> {
  const valid: Organ[] = ['brain', 'arms', 'builder', 'eyes', 'legs'];
  if (!valid.includes(organ as Organ)) {
    printError(`Unknown organ: ${organ}. Use: ${valid.join(', ')}`);
    process.exitCode = 1;
    return;
  }

  const componentId = ORGAN_TO_COMPONENT[organ];

  console.log();
  printHeader(`Growing ${organ.charAt(0).toUpperCase() + organ.slice(1)}`, emojis.sparkles);
  console.log();

  if (options.dryRun) {
    printInfo(`Would run: eve add ${componentId}`);
    return;
  }

  const shouldProceed = await confirm({
    message: `Install the ${organ} organ (eve add ${componentId})?`,
    initialValue: true,
  });

  if (isCancel(shouldProceed) || !shouldProceed) {
    console.log(colors.muted('Cancelled.'));
    return;
  }

  await runAdd(componentId, {});
}

async function growCapability(): Promise<void> {
  const state = await entityStateManager.getState();

  const organ = await select({
    message: 'Which organ would you like to enhance?',
    options: [
      { value: 'brain', label: '🧠 Brain', hint: state.organs.brain.state === 'ready' ? 'Installed' : 'Not installed' },
      { value: 'arms', label: '🦾 Arms', hint: state.organs.arms.state === 'ready' ? 'Installed' : 'Not installed' },
    ],
  });

  if (isCancel(organ)) {
    console.log(colors.muted('Cancelled.'));
    return;
  }
  if (typeof organ === 'string') {
    if (state.organs[organ as Organ].state !== 'ready') {
      printError(`${organ} organ is not installed. Run: eve grow organ ${organ}`);
      return;
    }

    printInfo(`Enhancing ${organ} capabilities... (coming soon)`);
  }
}

