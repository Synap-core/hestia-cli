#!/usr/bin/env node
/**
 * ignite command - Start all or specific packages
 * Usage: hestia ignite [package-names...]
 */

import { Command } from 'commander';
import { getConfigValue, getCredential } from '../lib/utils/index.js';
import { logger } from '../lib/utils/index.js';
import { runTasks } from '../lib/domains/shared/lib/task-list.js';
import { preFlightCheck } from '../lib/utils/preflight.js';
import { startPackage, getPackageStatus, isDockerRunning } from '../lib/services/docker-service.js';
import chalk from 'chalk';

interface IgniteOptions {
  verbose?: boolean;
  parallel?: boolean;
  retries?: number;
}

export function igniteCommand(program: Command): void {
  program
    .command('ignite [packages...]')
    .description('Start all or specific packages (like docker compose up)')
    .option('-v, --verbose', 'Show detailed output')
    .option('-p, --parallel', 'Start packages in parallel')
    .option('-r, --retries <number>', 'Number of retry attempts', '3')
    .action(async (packageNames: string[], options: IgniteOptions) => {
      try {
        // Pre-flight checks
        logger.header('PRE-FLIGHT CHECKS');
        const check = await preFlightCheck({
          docker: true,
          config: true,
          writeAccess: true
        });

        if (!check.ok) {
          logger.error('Pre-flight checks failed:');
          check.errors.forEach(e => logger.error(`  ✗ ${e}`));
          process.exit(1);
        }

        check.warnings.forEach(w => logger.warn(`  ⚠ ${w}`));
        logger.success('All pre-flight checks passed\n');

        const config = await getConfigValue();
        const baseUrl = config.connectors?.controlPlane?.url || 'http://localhost:4000';
        const _apiKey = await getCredential('apiKey') || '';

        logger.header('IGNITING HEARTH');
        logger.info(`Target: ${chalk.cyan(config.hearth.name || 'local')}`);
        logger.info(`Docker: ${chalk.cyan(await isDockerRunning() ? 'connected' : 'not available')}`);
        logger.newline();

        // Get packages to ignite
        const allPackages = Object.entries(config.packages || {})
          .filter(([_, p]: [string, any]) => p.enabled !== false)
          .map(([name, p]: [string, any]) => ({ 
            name, 
            status: p.status || 'stopped',
            type: p.type || 'docker'
          }));

        if (allPackages.length === 0) {
          logger.warn('No packages configured. Use "hestia add <package>" to add packages.');
          process.exit(0);
        }

        const targetPackages = packageNames.length > 0
          ? allPackages.filter((p: { name: string }) => packageNames.includes(p.name))
          : allPackages;

        if (targetPackages.length === 0) {
          if (packageNames.length > 0) {
            logger.error(`Specified packages not found: ${packageNames.join(', ')}`);
            process.exit(1);
          }
        }

        // Check current status
        logger.info('Checking current status...');
        const packagesWithStatus = await Promise.all(
          targetPackages.map(async (pkg) => {
            const status = await getPackageStatus(pkg.name);
            return { ...pkg, ...status };
          })
        );

        const toStart = packagesWithStatus.filter(p => !p.running);
        const alreadyRunning = packagesWithStatus.filter(p => p.running);

        if (alreadyRunning.length > 0) {
          logger.info(`Already running: ${alreadyRunning.map(p => chalk.cyan(p.name)).join(', ')}`);
        }

        if (toStart.length === 0) {
          logger.success('\nAll packages are already running!');
          return;
        }

        logger.info(`\nPackages to ignite: ${toStart.map(p => chalk.cyan(p.name)).join(', ')}`);
        logger.newline();

        // Create tasks for each package
        const tasks = toStart.map((pkg: { name: string; running: boolean }) => ({
          title: `Starting ${pkg.name}`,
          task: async (ctx: any) => {
            const retries = parseInt(options.retries?.toString() || '3', 10);
            let lastError: Error | null = null;

            for (let attempt = 1; attempt <= retries; attempt++) {
              try {
                logger.debug(`Attempt ${attempt}/${retries} for ${pkg.name}`);
                
                const result = await startPackage(pkg.name);
                
                if (result.success) {
                  ctx[`${pkg.name}_started`] = true;
                  logger.success(`  ✓ ${pkg.name} started successfully`);
                  return;
                } else {
                  throw new Error(result.message);
                }
              } catch (error: any) {
                lastError = error;
                logger.warn(`  Attempt ${attempt} failed: ${error.message}`);
                
                if (attempt < retries) {
                  const delay = 2000 * attempt;
                  logger.info(`  Retrying in ${delay}ms...`);
                  await sleep(delay);
                }
              }
            }

            throw lastError || new Error(`Failed to start ${pkg.name} after ${retries} attempts`);
          },
          skip: () => pkg.running,
        }));

        // Execute tasks
        if (options.parallel) {
          logger.info('Starting packages in parallel...\n');
          await Promise.all(tasks.map(t => t.task({})));
        } else {
          await runTasks(tasks, {
            concurrent: false,
            exitOnError: true,
            renderer: options.verbose ? 'verbose' : 'default'
          });
        }

        logger.newline();
        logger.success('✨ Hearth ignited successfully!');
        logger.info(`\n${chalk.dim('Use "hestia status" to check service status')}`);
        
      } catch (error: any) {
        logger.error(`Failed to ignite: ${error.message}`);
        if (options.verbose) {
          console.error(error);
        }
        process.exit(1);
      }
    });
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
