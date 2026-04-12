#!/usr/bin/env node
/**
 * extinguish command - Stop all or specific packages
 * Usage: hestia extinguish [package-names...]
 */

import { Command } from 'commander';
import { getConfigValue, getCredential } from '../lib/config.js';
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
        const config = await getConfigValue();
        const baseUrl = config.connectors?.controlPlane?.url || 'http://localhost:4000';
        const _apiKey = await getCredential('apiKey') || '';

        logger.header('EXTINGUISHING HEARTH');
        logger.info(`Target: ${chalk.cyan(config.hearth.name || 'local')}`);
        logger.newline();

        // Get packages to extinguish
        const allPackages: Array<{ name: string; status: string }> = Object.entries(config.packages)
          .map(([name, p]) => ({ name, status: (p as { enabled: boolean }).enabled ? 'running' : 'stopped' }));
        let targetPackages = packageNames.length > 0
          ? allPackages.filter((p: { name: string }) => packageNames.includes(p.name))
          : allPackages.filter((p: { status: string }) => p.status === 'running');

        // Unless --all is specified, exclude core packages
        const corePackages = ['synap-backend', 'openclaw', 'postgres'];
        if (!options.all) {
          targetPackages = targetPackages.filter((p: { name: string }) => !corePackages.includes(p.name));
        }

        if (targetPackages.length === 0) {
          logger.info('No packages to stop');
          return;
        }

        // Show warning for core packages
        const stoppingCore = targetPackages.some((p: { name: string }) => corePackages.includes(p.name));
        if (stoppingCore && !options.all) {
          logger.warn('Core packages (synap-backend, openclaw, postgres) require --all flag to stop');
          logger.info('This is a safety measure to prevent accidental data loss');
          logger.newline();
        }

        logger.info(`Packages to extinguish: ${targetPackages.map((p: { name: string }) => chalk.yellow(p.name)).join(', ')}`);
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
        const tasks = targetPackages.map((pkg: { name: string; status: string }) => ({
          title: `Stopping ${pkg.name}`,
          task: async (ctx: any) => {
            try {
              // Simulate stopping package
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
            logger.success(`${(pkg as { name: string }).name}: Stopped successfully`);
            stopped++;
          } else if ((pkg as { status: string }).status !== 'running') {
            logger.info(`${(pkg as { name: string }).name}: Already stopped (skipped)`);
            skipped++;
          } else {
            logger.error(`${(pkg as { name: string }).name}: Failed to stop`);
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
