/**
 * install command - Phase-based installation
 * Usage: hestia install [phase]
 * 
 * REFACTORED: Business logic extracted to src/application/install/
 * This file now only contains UI/interactive logic.
 */

import { Command } from 'commander';
import { logger, section } from '../lib/utils/index.js';
import { spinner } from '../lib/utils/index.js';
import chalk from 'chalk';
import { exec } from 'child_process';
import { promisify } from 'util';

// Import use cases from application layer
import {
  runPhase1,
  runPhase2,
  runPhase3,
  type Phase1Input,
  type Phase2Input,
  type Phase3Input,
} from '../application/install/index.js';
import { ProgressReporter } from '../application/types.js';

const execAsync = promisify(exec);

interface InstallOptions {
  target?: string;
  safeMode?: boolean;
  unattended?: boolean;
  skipPhases?: string[];
  dryRun?: boolean;
  skip?: string[];
}

type InstallPhase = 'phase1' | 'phase2' | 'phase3' | 'all';

/**
 * Create a CLI progress reporter
 */
function createProgressReporter(spinnerId: string): ProgressReporter {
  spinner.start(spinnerId, 'Initializing...');
  return {
    report(message: string): void {
      spinner.update(spinnerId, message);
    },
    onProgress(percent: number): void {
      const currentText = spinner['spinners']?.get(spinnerId)?.text || 'Working...';
      const baseText = currentText.split(' (')[0];
      spinner.update(spinnerId, `${baseText} (${Math.round(percent)}%)`);
    },
  };
}

export function installCommand(program: Command): void {
  program
    .command('install [phase]')
    .description('Run Hestia installation (phase1, phase2, phase3, or all)')
    .argument('[phase]', 'Installation phase', 'all')
    .option('-t, --target <path>', 'Installation target directory', '/opt/hestia')
    .option('-s, --safe-mode', 'Safe mode - preserve existing data')
    .option('-u, --unattended', 'Unattended installation (no prompts)')
    .option('--skip <phases...>', 'Skip specific phases (comma-separated)')
    .option('--dry-run', 'Show what would be done without executing')
    .action(async (phase: InstallPhase | 'all', options: InstallOptions) => {
      try {
        logger.header('HESTIA INSTALLER');

        // Validate phase
        const validPhases: InstallPhase[] = ['phase1', 'phase2', 'phase3'];
        const phasesToRun: InstallPhase[] = phase === 'all'
          ? validPhases
          : [phase];

        if (!validPhases.includes(phasesToRun[0]) && phase !== 'all') {
          logger.error(`Invalid phase: ${phase}`);
          logger.info(`Valid phases: ${validPhases.join(', ')}, all`);
          process.exit(1);
        }

        // Parse skip phases
        const skipPhases = options.skip ? options.skip.flatMap((s: string) => s.split(',')) : [];
        const filteredPhases = phasesToRun.filter((p) => !skipPhases.includes(p));

        if (filteredPhases.length === 0) {
          logger.info('All phases skipped. Nothing to do.');
          return;
        }

        logger.info(`Phases to run: ${filteredPhases.map((p) => chalk.cyan(p)).join(', ')}`);
        logger.info(`Target directory: ${chalk.cyan(options.target || '/opt/hestia')}`);
        logger.newline();

        // Pre-flight checks
        if (!options.dryRun) {
          const canProceed = await runPreflightChecks(options);
          if (!canProceed) {
            logger.error('Pre-flight checks failed. Aborting.');
            process.exit(1);
          }
        }

        // Run phases
        for (const p of filteredPhases) {
          await runPhase(p, options);
        }

        logger.newline();
        logger.success('Installation complete! 🔥');

        // Show next steps
        if (phase === 'all' || phase === 'phase3') {
          logger.newline();
          section('Next Steps');
          logger.info(`1. Initialize Hestia: ${chalk.cyan('hestia init')}`);
          logger.info(`2. Add packages: ${chalk.cyan('hestia add <package>')}`);
          logger.info(`3. Ignite hearth: ${chalk.cyan('hestia ignite')}`);
        }

      } catch (error: any) {
        logger.error(`Installation failed: ${error.message}`);
        process.exit(1);
      }
    });
}

/**
 * Run a single installation phase
 */
async function runPhase(phase: InstallPhase, options: InstallOptions): Promise<void> {
  section(`Running ${phase.toUpperCase()}`);

  if (options.dryRun) {
    logger.info(chalk.gray('[DRY RUN] Would execute phase'));
    return;
  }

  const spinnerId = `phase-${phase}`;
  const progress = createProgressReporter(spinnerId);

  let result;
  
  switch (phase) {
    case 'phase1': {
      const input: Phase1Input = {
        targetDir: options.target || '/opt/hestia',
        safeMode: options.safeMode,
        unattended: options.unattended,
        dryRun: options.dryRun,
      };
      result = await runPhase1(input, progress);
      break;
    }
    case 'phase2': {
      const input: Phase2Input = {
        targetDir: options.target || '/opt/hestia',
        safeMode: options.safeMode,
        unattended: options.unattended,
        dryRun: options.dryRun,
      };
      result = await runPhase2(input, progress);
      break;
    }
    case 'phase3': {
      const input: Phase3Input = {
        targetDir: options.target || '/opt/hestia',
        safeMode: options.safeMode,
        unattended: options.unattended,
        dryRun: options.dryRun,
      };
      result = await runPhase3(input, progress);
      break;
    }
    default:
      throw new Error(`Unknown phase: ${phase}`);
  }

  if (result.success) {
    spinner.succeed(spinnerId, `${phase} completed successfully`);
  } else {
    spinner.fail(spinnerId, `${phase} failed: ${result.error}`);
    throw new Error(result.error || `${phase} failed`);
  }
}

/**
 * Run pre-flight checks
 */
async function runPreflightChecks(options: InstallOptions): Promise<boolean> {
  section('Pre-flight Checks');

  const checks = [
    { name: 'Root/sudo access', fn: checkSudo },
    { name: 'Target directory writable', fn: () => checkDirectory(options.target || '/opt/hestia') },
    { name: 'Internet connectivity', fn: checkInternet },
    { name: 'Docker available', fn: checkDocker },
  ];

  let allPassed = true;

  for (const check of checks) {
    spinner.start(`check-${check.name}`, `Checking: ${check.name}`);
    try {
      const passed = await check.fn();
      if (passed) {
        spinner.succeed(`check-${check.name}`, `${check.name}: OK`);
      } else {
        spinner.fail(`check-${check.name}`, `${check.name}: FAILED`);
        allPassed = false;
      }
    } catch (error: any) {
      spinner.fail(`check-${check.name}`, `${check.name}: ERROR - ${error.message}`);
      allPassed = false;
    }
  }

  logger.newline();
  return allPassed;
}

// ============ Check Functions ============

async function checkSudo(): Promise<boolean> {
  try {
    if (process.getuid && process.getuid() === 0) {
      return true;
    }
    await execAsync('sudo -n true');
    return true;
  } catch {
    return false;
  }
}

async function checkDirectory(path: string): Promise<boolean> {
  try {
    await execAsync(`mkdir -p ${path}`);
    return true;
  } catch {
    return false;
  }
}

async function checkInternet(): Promise<boolean> {
  try {
    await execAsync('curl -s --max-time 5 https://cloudflare.com > /dev/null');
    return true;
  } catch {
    return false;
  }
}

async function checkDocker(): Promise<boolean> {
  try {
    await execAsync('docker version > /dev/null 2>&1');
    return true;
  } catch {
    return false;
  }
}
