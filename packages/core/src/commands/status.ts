/**
 * status command - Check hearth and package status
 * Usage: hestia status [package-name]
 */

import { Command } from 'commander';
import { getConfig } from '../lib/config.js';
import { ApiClient } from '../lib/api-client.js';
import { logger, table } from '../lib/logger.js';
import { spinner, withSpinner } from '../lib/spinner.js';
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
        const config = await getConfig();
        const api = new ApiClient(config);

        if (options.watch) {
          await watchStatus(api, packageName, options);
        } else {
          await showStatus(api, packageName, options);
        }
      } catch (error: any) {
        logger.error(`Failed to get status: ${error.message}`);
        process.exit(1);
      }
    });
}

async function showStatus(
  api: ApiClient,
  packageName: string | undefined,
  options: StatusOptions
): Promise<void> {
  const hearthId = (await getConfig()).hearthId;

  // Get hearth status
  const hearthStatus = await withSpinner(
    'Fetching hearth status...',
    () => api.getHearthStatus(hearthId),
    'Hearth status fetched'
  );

  if (options.json) {
    console.log(JSON.stringify(hearthStatus, null, 2));
    return;
  }

  // Display hearth info
  logger.header('HEARTH STATUS');
  logger.info(`ID: ${chalk.cyan(hearthStatus.hearthId || hearthId)}`);
  logger.info(`Hostname: ${chalk.cyan(hearthStatus.hostname || 'Unknown')}`);
  logger.info(`Role: ${chalk.cyan(hearthStatus.role || 'primary')}`);
  logger.info(`Health: ${formatHealth(hearthStatus.health || 'unknown')}`);
  logger.info(`Last Heartbeat: ${formatTimestamp(hearthStatus.lastHeartbeat)}`);

  if (options.verbose) {
    logger.newline();
    logger.section('System Resources');
    if (hearthStatus.resources) {
      logger.info(`CPU: ${chalk.cyan(hearthStatus.resources.cpu + '%')}`);
      logger.info(`Memory: ${chalk.cyan(hearthStatus.resources.memory + '%')}`);
      logger.info(`Disk: ${chalk.cyan(hearthStatus.resources.disk + '%')}`);
    }
  }

  // Get package statuses
  logger.newline();
  logger.header('PACKAGES');

  const packages = await api.listPackages({ hearthId });

  if (packages.length === 0) {
    logger.info('No packages installed.');
    return;
  }

  if (packageName) {
    const pkg = packages.find((p) => p.name === packageName);
    if (!pkg) {
      logger.error(`Package '${packageName}' not found`);
      process.exit(1);
    }
    displayPackageDetails(pkg, options.verbose);
  } else {
    // Show package summary table
    const tableData = packages.map((pkg) => ({
      NAME: pkg.name,
      VERSION: pkg.version,
      STATUS: formatStatus(pkg.status),
      TYPE: pkg.packageType,
      HEALTH: formatHealth(pkg.health || 'unknown'),
    }));

    table(tableData);

    if (options.verbose) {
      logger.newline();
      for (const pkg of packages) {
        displayPackageDetails(pkg, false);
        logger.newline();
      }
    }
  }
}

async function watchStatus(
  api: ApiClient,
  packageName: string | undefined,
  options: StatusOptions
): Promise<void> {
  const interval = 2000; // 2 seconds

  logger.info(`Watching status (press Ctrl+C to exit)...\n`);

  const run = async () => {
    // Clear screen
    process.stdout.write('\x1Bc');

    try {
      await showStatus(api, packageName, { ...options, json: false });
    } catch (error) {
      logger.error('Failed to fetch status');
    }

    logger.newline();
    logger.info(chalk.gray(`Last updated: ${new Date().toLocaleTimeString()}`));
    logger.info(chalk.gray('Press Ctrl+C to exit'));
  };

  await run();
  const timer = setInterval(run, interval);

  // Handle exit
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
  logger.info(`Status: ${formatStatus(pkg.status)}`);
  logger.info(`Type: ${chalk.cyan(pkg.packageType)}`);
  logger.info(`Health: ${formatHealth(pkg.health || 'unknown')}`);

  if (verbose) {
    if (pkg.endpoints && pkg.endpoints.length > 0) {
      logger.info(`Endpoints: ${pkg.endpoints.map((e: string) => chalk.cyan(e)).join(', ')}`);
    }
    if (pkg.uptime) {
      logger.info(`Uptime: ${chalk.cyan(formatUptime(pkg.uptime))}`);
    }
    if (pkg.lastUpdated) {
      logger.info(`Last Updated: ${formatTimestamp(pkg.lastUpdated)}`);
    }
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

function formatTimestamp(timestamp?: string): string {
  if (!timestamp) return chalk.gray('Never');
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  if (diff < 60000) return chalk.green('Just now');
  if (diff < 3600000) return chalk.cyan(`${Math.floor(diff / 60000)}m ago`);
  if (diff < 86400000) return chalk.cyan(`${Math.floor(diff / 3600000)}h ago`);
  return chalk.gray(date.toLocaleDateString());
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
