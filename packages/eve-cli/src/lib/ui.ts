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

// Simple spinner using stdout
export function createSpinner(text: string) {
  let interval: NodeJS.Timeout;
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;
  
  return {
    start() {
      process.stdout.write(colors.info(`${frames[0]} ${text}`));
      interval = setInterval(() => {
        process.stdout.write(`\r${colors.info(`${frames[i]} ${text}`)}`);
        i = (i + 1) % frames.length;
      }, 80);
    },
    succeed(msg?: string) {
      clearInterval(interval);
      console.log(`\r${colors.success(`${emojis.check} ${msg || text}`)}`);
    },
    fail(msg?: string) {
      clearInterval(interval);
      console.log(`\r${colors.error(`${emojis.cross} ${msg || text}`)}`);
    },
    warn(msg?: string) {
      clearInterval(interval);
      console.log(`\r${colors.warning(`${emojis.warning} ${msg || text}`)}`);
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

/**
 * Print a loud deprecation banner for eve commands that silently delegate to
 * the Synap bash script. The user must opt in with `--confirm-delegation` to
 * actually run the underlying command — see `requireDelegationConfirmed`.
 *
 * Centralising this makes the boundary explicit and discoverable, and keeps
 * the exit semantics consistent (exit 2 when the confirm flag is missing).
 */
export function printEveDeprecation(command: string, suggested: string): void {
  console.log(
    `
${colors.warning('⚠️')}  ${colors.warning.bold(`\`eve ${command}\` is deprecated.`)}
    This command delegates to the Synap bash script.
    Please use instead:
        ${colors.info(suggested)}
    (eve organs/brain/arms subcommands remain available for Eve Entity System use.)
`
  );
}

/**
 * Gate used by the deprecated commands above. Checks process.argv for
 * `--confirm-delegation`; if absent, exits 2 without running the command.
 *
 * We read argv directly instead of wiring a Commander option on every
 * command — keeps the opt-in uniform and impossible to forget.
 */
export function requireDelegationConfirmed(): void {
  if (!process.argv.includes('--confirm-delegation')) {
    console.log(
      colors.muted(
        '    Pass --confirm-delegation to proceed anyway (not recommended).\n'
      )
    );
    process.exit(2);
  }
}
