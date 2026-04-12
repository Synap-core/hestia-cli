/**
 * extinguish command - Stop all or specific packages
 * Usage: hestia extinguish [package-names...]
 */

import { Command } from 'commander';
import { getConfig } from '../lib/config.js';
import { ApiClient } from '../lib/api-client.js';
import { logger } from '../lib/logger.js';
import { runTasks } from '../lib/task-list.js';
import chalk from 'chalk';
import inquirer from 'inquirer';

interface ExtinguishOptions {
  verbose?: boolean;
  force?: boolean;
  parallel?: boolean;
  all?: boolean;
}

export function extinguishCommand(program: Command): void {
  program
    .command('extinguish [packages...]')
    .description('Stop all or specific packages')
    .option('-v, --verbose', 'Show detailed output')
    .option('-f, --force', 'Force stop without confirmation')
    .option('-p, --parallel', 'Stop packages in parallel')
    .option('-a, --all', 'Stop all packages including core services')
    .action(async (packageNames: string[], options: ExtinguishOptions) => {
      try {
        const config = await getConfig();
        const api = new ApiClient(config);

        logger.header('EXTINGUISHING HEARTH');
        logger.info(`Target: ${chalk.cyan(config.hearthId || 'local')}`);
        logger.newline();

        // Get packages to extinguish
        const allPackages = await api.listPackages({});
        let targetPackages = packageNames.length > 0
          ? allPackages.filter((p) => packageNames.includes(p.name))
          : allPackages.filter((p) => p.status === 'running');

        // Unless --all is specified, exclude core packages
        const corePackages = ['synap-backend', 'openclaw', 'postgres'];
        if (!options.all) {
          targetPackages = targetPackages.filter((p) => !corePackages.includes(p.name));
        }

        if (targetPackages.length === 0) {
          logger.info('No packages to stop');
          return;
        }

        // Show warning for core packages
        const stoppingCore = targetPackages.some((p) => corePackages.includes(p.name));
        if (stoppingCore && !options.all) {
          logger.warn('Core packages (synap-backend, openclaw, postgres) require --all flag to stop');
          logger.info('This is a safety measure to prevent accidental data loss');
          logger.newline();
        }

        logger.info(`Packages to extinguish: ${targetPackages.map((p) => chalk.yellow(p.name)).join(', ')}`);
        logger.newline();

        // Confirm unless --force
        if (!options.force && !options.all) {
          const { confirm } = await inquirer.prompt([{
            type: 'confirm',
            name: 'confirm',
            message: `Stop ${targetPackages.length} package(s)?`,
            default: false,
          }]);

          if (!confirm) {
            logger.info('Extinguish cancelled');
            return;
          }
        }

        // Create tasks for each package
        const tasks = targetPackages.map((pkg) => ({
          title: `Stopping ${pkg.name}`,
          task: async (ctx: any) => {
            try {
              await api.stopPackage(pkg.name);
              ctx[`${pkg.name}_stopped`] = true;
            } catch (error: any) {
              // Some packages might already be stopped
              if (error.message?.includes('not running')) {
                ctx[`${pkg.name}_stopped`] = true;
                return;
              }
              throw error;
            }
          },
          skip: () => pkg.status !== 'running',
        }));

        // Execute tasks
        const context = await runTasks(tasks, {
          concurrent: options.parallel || false,
          exitOnError: false,
        });

        // Summary
        logger.newline();
        logger.header('EXTINGUISH SUMMARY');

        let stopped = 0;
        let skipped = 0;
        let failed = 0;

        for (const pkg of targetPackages) {
          const key = `${pkg.name}_stopped`;
          if (context[key]) {
            logger.success(`${pkg.name}: Stopped successfully`);
            stopped++;
          } else if (pkg.status !== 'running') {
            logger.info(`${pkg.name}: Already stopped (skipped)`);
            skipped++;
          } else {
            logger.error(`${pkg.name}: Failed to stop`);
            failed++;
          }
        }

        logger.newline();
        logger.info(`Total: ${chalk.green(stopped + ' stopped')}, ${chalk.gray(skipped + ' skipped')}, ${chalk.red(failed + ' failed')}`);

        if (failed > 0) {
          process.exit(1);
        }

        logger.newline();
        logger.success('Hearth extinguished. 🌙');

      } catch (error: any) {
        logger.error(`Extinguish failed: ${error.message}`);
        process.exit(1);
      }
    });
}
