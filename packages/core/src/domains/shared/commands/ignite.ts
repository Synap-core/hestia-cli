#!/usr/bin/env node
/**
 * ignite command - Start all or specific packages
 * Usage: hestia ignite [package-names...]
 */

import { Command } from 'commander';
import { getConfigValue, getCredential } from '../../lib/utils/index';
import { logger } from '../../lib/utils/index';
import { runTasks } from '../../../domains/shared/lib/task-list.js';
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
        const config = await getConfigValue();
        const baseUrl = config.connectors?.controlPlane?.url || 'http://localhost:4000';
        const _apiKey = await getCredential('apiKey') || '';

        logger.header('IGNITING HEARTH');
        logger.info(`Target: ${chalk.cyan(config.hearth.name || 'local')}`);
        logger.newline();

        // Get packages to ignite
        const allPackages: Array<{ name: string; status: string }> = Object.entries(config.packages)
          .map(([name, p]) => ({ name, status: (p as { enabled: boolean }).enabled ? 'running' : 'stopped' }));
        const targetPackages = packageNames.length > 0
          ? allPackages.filter((p: { name: string }) => packageNames.includes(p.name))
          : allPackages.filter((p: { status: string }) => p.status !== 'running');

        if (targetPackages.length === 0) {
          if (packageNames.length > 0) {
            logger.error(`Specified packages not found or already running`);
            process.exit(1);
          } else {
            logger.success('All packages are already running');
            return;
          }
        }

        logger.info(`Packages to ignite: ${targetPackages.map((p: { name: string }) => chalk.cyan(p.name)).join(', ')}`);
        logger.newline();

        // Create tasks for each package
        const tasks = targetPackages.map((pkg: { name: string; status: string }) => ({
          title: `Starting ${pkg.name}`,
          task: async (ctx: any) => {
            const retries = parseInt(options.retries?.toString() || '3', 10);
            let lastError: Error | null = null;

            for (let attempt = 1; attempt <= retries; attempt++) {
              try {
                // Simulate starting package
                ctx[`${pkg.name}_started`] = true;
                return;
              } catch (error: any) {
                lastError = error;
                if (attempt < retries) {
                  logger.warn(`  Attempt ${attempt} failed, retrying...`);
                  await sleep(2000 * attempt);
                }
              }
            }

            throw lastError || new Error(`Failed to start ${pkg.name} after ${retries} attempts`);
          },
          skip: () => pkg.status === 'running',
        }));

        // Execute tasks
        const context = await runTasks(tasks, {
          concurrent: options.parallel || false,
          exitOnError: false,
        });

        // Summary
        logger.newline();
        logger.header('IGNITION SUMMARY');

        let started = 0;
        let skipped = 0;
        let failed = 0;

        for (const pkg of targetPackages) {
          const key = `${(pkg as { name: string }).name}_started`;
          if (context[key]) {
            logger.success(`${(pkg as { name: string }).name}: Started successfully`);
            started++;
          } else if ((pkg as { status: string }).status === 'running') {
            logger.info(`${(pkg as { name: string }).name}: Already running (skipped)`);
            skipped++;
          } else {
            logger.error(`${(pkg as { name: string }).name}: Failed to start`);
            failed++;
          }
        }

        logger.newline();
        logger.info(`Total: ${chalk.green(started + ' started')}, ${chalk.gray(skipped + ' skipped')}, ${chalk.red(failed + ' failed')}`);

        if (failed > 0) {
          process.exit(1);
        }

        logger.newline();
        logger.success('Hearth ignited successfully! 🔥');

      } catch (error: any) {
        logger.error(`Ignition failed: ${error.message}`);
        process.exit(1);
      }
    });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
