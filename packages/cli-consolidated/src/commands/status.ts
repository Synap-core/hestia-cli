/**
 * status command - Check hearth and package status
 * Usage: eve status [package-name]
 */

import { Command } from 'commander';
import { getConfigValue } from '../lib/utils/index.js';
import { logger, table } from '../lib/utils/index.js';
import { getPackageStatus, getDockerInfo } from '../lib/services/docker-service.js';
import chalk from 'chalk';

interface StatusOptions {
  json?: boolean;
  watch?: boolean;
  verbose?: boolean;
}

export function statusCommand(program: Command): void {
  program
    .command('status [package-name]')
    .description('Check hearth and package status')
    .option('-j, --json', 'Output as JSON')
    .option('-w, --watch', 'Watch mode - continuously update')
    .option('-v, --verbose', 'Show detailed information')
    .action(async (packageName: string | undefined, options: StatusOptions) => {
      try {
        if (options.watch) {
          await watchStatus(packageName, options);
        } else {
          await showStatus(packageName, options);
        }
      } catch (error: any) {
        logger.error(`Failed to get status: ${error.message}`);
        process.exit(1);
      }
    });
}

async function showStatus(
  packageName: string | undefined,
  options: StatusOptions
): Promise<void> {
  const config = await getConfigValue();
  const hearthId = config.hearth?.name || 'unknown';

  // Get real Docker status
  const dockerInfo = await getDockerInfo();
  const dockerRunning = dockerInfo.running;

  // Get hearth status
  const hearthStatus = {
    hearthId,
    hostname: config.hearth?.name || 'Unknown',
    role: config.hearth?.role || 'primary',
    health: dockerRunning ? 'healthy' : 'degraded',
    lastHeartbeat: new Date().toISOString(),
    docker: dockerRunning ? 'connected' : 'not available',
    resources: dockerRunning ? {
      containers: dockerInfo.containers,
      images: dockerInfo.images
    } : null
  };

  if (options.json) {
    // Get real package statuses for JSON output
    const packages = await getAllPackageStatuses(config);
    console.log(JSON.stringify({ ...hearthStatus, packages }, null, 2));
    return;
  }

  // Display hearth info
  logger.header('HEARTH STATUS');
  logger.info(`ID: ${chalk.cyan(hearthStatus.hearthId)}`);
  logger.info(`Hostname: ${chalk.cyan(hearthStatus.hostname)}`);
  logger.info(`Role: ${chalk.cyan(hearthStatus.role)}`);
  logger.info(`Health: ${formatHealth(hearthStatus.health)}`);
  logger.info(`Docker: ${dockerRunning ? chalk.green('connected') : chalk.red('not available')}`);

  if (options.verbose && dockerRunning) {
    logger.newline();
    logger.section('Docker Resources');
    logger.info(`Containers: ${chalk.cyan(`${dockerInfo.containers.running} running / ${dockerInfo.containers.total} total`)}`);
    logger.info(`Images: ${chalk.cyan(dockerInfo.images)}`);
  }

  // Get package statuses
  logger.newline();
  logger.header('PACKAGES');

  const packages = await getAllPackageStatuses(config);

  if (packages.length === 0) {
    logger.info('No packages configured.');
    logger.info(chalk.dim('Use "eve add <package>" to add packages.'));
    return;
  }

  if (packageName) {
    const pkg = packages.find((p: { name: string }) => p.name === packageName);
    if (!pkg) {
      logger.error(`Package '${packageName}' not found`);
      process.exit(1);
    }
    displayPackageDetails(pkg, options.verbose || false);
  } else {
    // Show package summary table
    const tableData = packages.map((pkg: { name: string; version: string; status: string; running: boolean; health: string }) => ({
      NAME: pkg.name,
      VERSION: pkg.version,
      STATUS: formatStatus(pkg.running ? 'running' : 'stopped'),
      TYPE: 'docker',
      HEALTH: formatHealth(pkg.health),
    }));

    table(tableData);

    if (options.verbose) {
      logger.newline();
      for (const pkg of packages) {
        displayPackageDetails(pkg, true);
        logger.newline();
      }
    }
  }
}

async function getAllPackageStatuses(config: any): Promise<Array<{
  name: string;
  version: string;
  status: string;
  running: boolean;
  health: string;
  containers: any[];
}>> {
  const packages = Object.entries(config.packages || {})
    .map(([name, p]: [string, any]) => ({ name, config: p }));

  const statuses = await Promise.all(
    packages.map(async ({ name, config: pkgConfig }) => {
      const status = await getPackageStatus(name);
      return {
        name,
        version: pkgConfig?.version || 'latest',
        status: status.running ? 'running' : 'stopped',
        running: status.running,
        health: status.running ? 'healthy' : 'unknown',
        containers: status.containers
      };
    })
  );

  return statuses;
}

async function watchStatus(
  packageName: string | undefined,
  options: StatusOptions
): Promise<void> {
  const interval = 2000;

  logger.info(`Watching status (press Ctrl+C to exit)...\n`);

  const run = async () => {
    process.stdout.write('\x1Bc');

    try {
      await showStatus(packageName, { ...options, json: false });
    } catch (error) {
      logger.error('Failed to fetch status');
    }

    logger.newline();
    logger.info(chalk.gray(`Last updated: ${new Date().toLocaleTimeString()}`));
    logger.info(chalk.gray('Press Ctrl+C to exit'));
  };

  await run();
  const timer = setInterval(run, interval);

  process.on('SIGINT', () => {
    clearInterval(timer);
    logger.newline();
    logger.info('Stopped watching');
    process.exit(0);
  });
}

function displayPackageDetails(pkg: any, verbose: boolean): void {
  logger.section(pkg.name);
  logger.info(`Version: ${chalk.cyan(pkg.version)}`);
  logger.info(`Status: ${formatStatus(pkg.running ? 'running' : 'stopped')}`);
  logger.info(`Type: ${chalk.cyan('docker')}`);
  logger.info(`Health: ${formatHealth(pkg.health)}`);

  if (verbose && pkg.containers && pkg.containers.length > 0) {
    logger.newline();
    logger.info(chalk.dim('Containers:'));
    pkg.containers.forEach((container: any) => {
      logger.info(`  ${chalk.cyan(container.name)}: ${formatStatus(container.status)}`);
      if (container.ports && container.ports.length > 0) {
        logger.info(`    Ports: ${container.ports.join(', ')}`);
      }
    });
  }
}

function formatStatus(status: string): string {
  const colors: Record<string, (s: string) => string> = {
    running: (s) => chalk.green(s),
    stopped: (s) => chalk.gray(s),
    error: (s) => chalk.red(s),
    pending: (s) => chalk.yellow(s),
    installing: (s) => chalk.blue(s),
    unknown: (s) => chalk.gray(s),
  };
  return (colors[status] || colors.unknown)(status);
}

function formatHealth(health: string): string {
  const colors: Record<string, (s: string) => string> = {
    healthy: (s) => chalk.green('✓ ' + s),
    degraded: (s) => chalk.yellow('⚠ ' + s),
    unhealthy: (s) => chalk.red('✗ ' + s),
    unknown: (s) => chalk.gray('? ' + s),
  };
  return (colors[health] || colors.unknown)(health);
}
