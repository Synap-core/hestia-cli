#!/usr/bin/env node
/**
 * extinguish command - Stop all or specific packages
 * Usage: hestia extinguish [package-names...]
 */

import { Command } from 'commander';
import { getConfigValue, getCredential } from '../lib/utils/index.js';
import { logger } from '../lib/utils/index.js';
import { runTasks } from '../lib/domains/shared/lib/task-list.js';
import { preFlightCheck } from '../lib/utils/preflight.js';
import { stopPackage, getPackageStatus } from '../lib/services/docker-service.js';
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
    .description('Stop all or specific packages (like docker compose down)')
    .option('-v, --verbose', 'Show detailed output')
    .option('-f, --force', 'Force stop without confirmation')
    .option('-p, --parallel', 'Stop packages in parallel')
    .option('-a, --all', 'Stop all packages including core services')
    .action(async (packageNames: string[], options: ExtinguishOptions) => {
      try {
        // Pre-flight checks
        logger.header('PRE-FLIGHT CHECKS');
        const check = await preFlightCheck({
          docker: true,
          config: true
        });

        if (!check.ok) {
          logger.error('Pre-flight checks failed:');
          check.errors.forEach(e => logger.error(`  ✗ ${e}`));
          process.exit(1);
        }

        logger.success('All pre-flight checks passed\n');

        const config = await getConfigValue();
        const _apiKey = await getCredential('apiKey') || '';

        logger.header('EXTINGUISHING HEARTH');
        logger.info(`Target: ${chalk.cyan(config.hearth.name || 'local')}`);
        logger.newline();

        // Get all enabled packages
        const allPackages = Object.entries(config.packages || {})
          .filter(([_, p]: [string, any]) => p.enabled !== false)
          .map(([name]) => ({ name }));

        if (allPackages.length === 0) {
          logger.warn('No packages configured.');
          process.exit(0);
        }

        // Check current status of all packages
        logger.info('Checking current status...');
        const packagesWithStatus = await Promise.all(
          allPackages.map(async (pkg) => {
            const status = await getPackageStatus(pkg.name);
            return { ...pkg, ...status };
          })
        );

        let targetPackages = packageNames.length > 0
          ? packagesWithStatus.filter(p => packageNames.includes(p.name))
          : packagesWithStatus.filter(p => p.running);

        // Unless --all is specified, exclude core packages
        const corePackages = ['synap-backend', 'synap-postgres', 'synap-redis', 'synap-typesense'];
        if (!options.all) {
          targetPackages = targetPackages.filter(p => !corePackages.includes(p.name));
        }

        if (targetPackages.length === 0) {
          logger.info('No packages to stop');
          return;
        }

        // Show warning for core packages
        const stoppingCore = targetPackages.some(p => corePackages.includes(p.name));
        if (stoppingCore && options.all) {
          logger.warn('⚠️  Stopping core packages may cause data loss!');
          logger.warn('   Core packages: ' + corePackages.join(', '));
          logger.newline();
        }

        logger.info(`Packages to extinguish: ${targetPackages.map(p => chalk.yellow(p.name)).join(', ')}`);
        logger.newline();

        // Confirm unless --force
        if (!options.force) {
          const { confirm } = await inquirer.prompt([{
            type: 'confirm',
            name: 'confirm',
            message: `Stop ${targetPackages.length} package(s)?`,
            default: false
          }]);

          if (!confirm) {
            logger.info('Operation cancelled.');
            return;
          }
        }

        logger.newline();

        // Create tasks for each package
        const tasks = targetPackages.map((pkg) => ({
          title: `Stopping ${pkg.name}`,
          task: async (ctx: any) => {
            try {
              logger.debug(`Stopping ${pkg.name}...`);
              
              const result = await stopPackage(pkg.name);
              
              if (result.success) {
                ctx[`${pkg.name}_stopped`] = true;
                logger.success(`  ✓ ${pkg.name} stopped`);
                return;
              } else {
                throw new Error(result.message);
              }
            } catch (error: any) {
              // Some packages might already be stopped
              if (error.message?.includes('not running') || error.message?.includes('No such container')) {
                ctx[`${pkg.name}_stopped`] = true;
                logger.info(`  ℹ ${pkg.name} already stopped`);
                return;
              }
              throw error;
            }
          },
          skip: () => !pkg.running,
        }));

        // Execute tasks
        const context = await runTasks(tasks, {
          concurrent: options.parallel || false,
          exitOnError: false,
          renderer: options.verbose ? 'verbose' : 'default'
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
          } else if (!pkg.running) {
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
        logger.success('🔥 Hearth extinguished successfully');
        logger.info(`\n${chalk.dim('Use "hestia ignite" to restart services')}`);

      } catch (error: any) {
        logger.error(`Failed to extinguish: ${error.message}`);
        if (options.verbose) {
          console.error(error);
        }
        process.exit(1);
      }
    });
}
