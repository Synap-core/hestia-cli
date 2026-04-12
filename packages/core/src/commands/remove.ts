// @ts-nocheck
/**
 * remove command - Remove a package from the hearth
 * Usage: hestia remove <package-name>
 */

import { Command } from 'commander';
import { getConfigValue, getCredential } from '../lib/config.js';
import { logger } from '../lib/logger.js';
import { withSpinner } from '../lib/spinner.js';
import { PackageService } from '../lib/package-service.js';
import chalk from 'chalk';
import inquirer from 'inquirer';

interface RemoveOptions {
  force?: boolean;
  purge?: boolean;
  keepData?: boolean;
}

export function removeCommand(program: Command): void {
  program
    .command('remove <package-name>')
    .description('Remove a package from the hearth')
    .option('-f, --force', 'Force removal without confirmation')
    .option('-p, --purge', 'Remove all package data and configuration')
    .option('-k, --keep-data', 'Keep package data volumes')
    .action(async (packageName: string, options: RemoveOptions) => {
      try {
        const config = await getConfigValue();
        const baseUrl = config.connectors?.controlPlane?.url || 'http://localhost:4000';
        const _apiKey = await getCredential('apiKey') || '';
        const pkgService = new PackageService({ config, packagesDir: '/tmp/packages', logger });

        logger.header('REMOVING PACKAGE');
        logger.info(`Package: ${chalk.yellow(packageName)}`);
        logger.newline();

        // Check if package exists
        const packages: Array<{ name: string; status: string; version: string }> = Object.entries(config.packages)
          .map(([name, p]) => ({ name, version: (p as { version?: string }).version || 'latest', status: (p as { enabled: boolean }).enabled ? 'running' : 'stopped' }));
        const pkg = packages.find((p: { name: string }) => p.name === packageName);

        if (!pkg) {
          logger.error(`Package '${packageName}' not found`);
          process.exit(1);
        }

        // Show package info
        logger.info(`Current status: ${(pkg as { status: string }).status}`);
        logger.info(`Version: ${(pkg as { version: string }).version}`);
        logger.newline();

        // Check if running
        if ((pkg as { status: string }).status === 'running' && !options.force) {
          const { stopFirst } = await inquirer.prompt([{
            type: 'confirm',
            name: 'stopFirst',
            message: `Package ${packageName} is currently running. Stop it first?`,
            default: true,
          }]);

          if (stopFirst) {
            await withSpinner(
              `Stopping ${packageName}...`,
              () => api.stopPackage(packageName),
              `${packageName} stopped`
            );
          } else if (!options.force) {
            logger.error('Cannot remove a running package. Use --force to override.');
            process.exit(1);
          }
        }

        // Confirmation
        if (!options.force) {
          const warning = options.purge
            ? `WARNING: This will remove ${packageName} and ALL its data permanently.`
            : `Remove ${packageName}?`;

          logger.warn(warning);
          logger.newline();

          const { confirm } = await inquirer.prompt([{
            type: 'confirm',
            name: 'confirm',
            message: 'Are you sure?',
            default: false,
          }]);

          if (!confirm) {
            logger.info('Removal cancelled');
            return;
          }

          // Double confirm for purge
          if (options.purge) {
            const { confirmPurge } = await inquirer.prompt([{
              type: 'input',
              name: 'confirmPurge',
              message: `Type "${packageName}" to confirm purge:`,
            }]);

            if (confirmPurge !== packageName) {
              logger.error('Confirmation mismatch. Removal cancelled.');
              process.exit(1);
            }
          }
        }

        // Stop if running and force
        if ((pkg as { status: string }).status === 'running' && options.force) {
          await withSpinner(
            `Force stopping ${packageName}...`,
            () => pkgService.stop(packageName),
            `${packageName} stopped`
          );
        }

        // Remove files
        await withSpinner(
          'Removing package files...',
          () => pkgService.remove(packageName, options.purge, options.keepData),
          'Package files removed'
        );

        logger.newline();
        logger.success(`Package ${packageName} removed successfully 🗑️`);

        if (!options.purge && !options.keepData) {
          logger.info(`Data preserved. Use ${chalk.cyan(`hestia remove ${packageName} --purge`)} to remove all data`);
        }

      } catch (error: any) {
        logger.error(`Failed to remove package: ${error.message}`);
        process.exit(1);
      }
    });
}
