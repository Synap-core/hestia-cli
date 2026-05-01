import chalk from 'chalk';
import boxen from 'boxen';

// Simple color palette using chalk only
export const colors = {
  primary: chalk.hex('#6366f1'),
  success: chalk.green,
  warning: chalk.yellow,
  error: chalk.red,
  info: chalk.blue,
  muted: chalk.gray,
  brain: chalk.hex('#f59e0b'),
  arms: chalk.green,
  builder: chalk.blue,
  eyes: chalk.magenta,
  legs: chalk.cyan,
};

// Emojis
export const emojis = {
  brain: '🧠',
  arms: '🦾',
  builder: '🏗️',
  eyes: '👁️',
  legs: '🦿',
  entity: '🌿',
  success: '✅',
  error: '❌',
  warning: '⚠️',
  info: 'ℹ️',
  sparkles: '✨',
  check: '✓',
  cross: '✗',
  bullet: '•',
};

// Simple spinner using stdout. \x1b[2K clears the entire line BEFORE writing
// new content so shorter "succeed" text doesn't leave a tail of the longer
// spinner text behind.
const CLEAR_LINE = '\r\x1b[2K';

export function createSpinner(text: string) {
  let interval: NodeJS.Timeout;
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;

  return {
    start() {
      process.stdout.write(`${CLEAR_LINE}${colors.info(`${frames[0]} ${text}`)}`);
      interval = setInterval(() => {
        process.stdout.write(`${CLEAR_LINE}${colors.info(`${frames[i]} ${text}`)}`);
        i = (i + 1) % frames.length;
      }, 80);
    },
    succeed(msg?: string) {
      clearInterval(interval);
      console.log(`${CLEAR_LINE}${colors.success(`${emojis.check} ${msg || text}`)}`);
    },
    fail(msg?: string) {
      clearInterval(interval);
      console.log(`${CLEAR_LINE}${colors.error(`${emojis.cross} ${msg || text}`)}`);
    },
    warn(msg?: string) {
      clearInterval(interval);
      console.log(`${CLEAR_LINE}${colors.warning(`${emojis.warning} ${msg || text}`)}`);
    },
  };
}

// Print helpers
export function printHeader(title: string, emoji?: string): void {
  console.log();
  console.log(colors.primary.bold(`${emoji ? emoji + ' ' : ''}${title}`));
  console.log(colors.primary('─'.repeat(title.length + (emoji ? 2 : 0))));
}

export function printSuccess(message: string): void {
  console.log(colors.success(`${emojis.success} ${message}`));
}

export function printError(message: string): void {
  console.log(colors.error(`${emojis.error} ${message}`));
}

export function printWarning(message: string): void {
  console.log(colors.warning(`${emojis.warning} ${message}`));
}

export function printInfo(message: string): void {
  console.log(colors.info(`${emojis.info} ${message}`));
}

export function printBullet(message: string, indent = 0): void {
  const indentStr = '  '.repeat(indent);
  console.log(`${indentStr}${colors.muted(emojis.bullet)} ${message}`);
}

export function printKeyValue(key: string, value: string, keyWidth = 20): void {
  const paddedKey = key.padEnd(keyWidth);
  console.log(`${colors.muted(paddedKey)} ${value}`);
}

export function formatOrgan(organ: string): string {
  const organColors: Record<string, (text: string) => string> = {
    brain: colors.brain,
    arms: colors.arms,
    builder: colors.builder,
    eyes: colors.eyes,
    legs: colors.legs,
  };
  const color = organColors[organ] || colors.info;
  const emoji = emojis[organ as keyof typeof emojis] || emojis.bullet;
  return color(`${emoji} ${organ.charAt(0).toUpperCase() + organ.slice(1)}`);
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Framed summary block (uses boxen + theme primary border) */
export function printBox(title: string, lines: string[]): void {
  const body = lines.join('\n');
  console.log(
    boxen(`${colors.primary.bold(title)}\n\n${body}`, {
      padding: 1,
      margin: { top: 0, bottom: 1, left: 0, right: 0 },
      borderStyle: 'round',
      borderColor: '#6366f1',
    })
  );
}

