#!/usr/bin/env node
/**
 * ignite command - Start all or specific packages
 * Usage: hestia ignite [package-names...]
 */
import { getConfigValue, getCredential } from '../lib/config.js';
import { logger } from '../lib/logger.js';
import { runTasks } from '../lib/task-list.js';
import chalk from 'chalk';
export function igniteCommand(program) {
    program
        .command('ignite [packages...]')
        .description('Start all or specific packages (like docker compose up)')
        .option('-v, --verbose', 'Show detailed output')
        .option('-p, --parallel', 'Start packages in parallel')
        .option('-r, --retries <number>', 'Number of retry attempts', '3')
        .action(async (packageNames, options) => {
        try {
            const config = await getConfigValue();
            const baseUrl = config.connectors?.controlPlane?.url || 'http://localhost:4000';
            const _apiKey = await getCredential('apiKey') || '';
            logger.header('IGNITING HEARTH');
            logger.info(`Target: ${chalk.cyan(config.hearth.name || 'local')}`);
            logger.newline();
            // Get packages to ignite
            const allPackages = Object.entries(config.packages)
                .map(([name, p]) => ({ name, status: p.enabled ? 'running' : 'stopped' }));
            const targetPackages = packageNames.length > 0
                ? allPackages.filter((p) => packageNames.includes(p.name))
                : allPackages.filter((p) => p.status !== 'running');
            if (targetPackages.length === 0) {
                if (packageNames.length > 0) {
                    logger.error(`Specified packages not found or already running`);
                    process.exit(1);
                }
                else {
                    logger.success('All packages are already running');
                    return;
                }
            }
            logger.info(`Packages to ignite: ${targetPackages.map((p) => chalk.cyan(p.name)).join(', ')}`);
            logger.newline();
            // Create tasks for each package
            const tasks = targetPackages.map((pkg) => ({
                title: `Starting ${pkg.name}`,
                task: async (ctx) => {
                    const retries = parseInt(options.retries?.toString() || '3', 10);
                    let lastError = null;
                    for (let attempt = 1; attempt <= retries; attempt++) {
                        try {
                            // Simulate starting package
                            ctx[`${pkg.name}_started`] = true;
                            return;
                        }
                        catch (error) {
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
                const key = `${pkg.name}_started`;
                if (context[key]) {
                    logger.success(`${pkg.name}: Started successfully`);
                    started++;
                }
                else if (pkg.status === 'running') {
                    logger.info(`${pkg.name}: Already running (skipped)`);
                    skipped++;
                }
                else {
                    logger.error(`${pkg.name}: Failed to start`);
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
        }
        catch (error) {
            logger.error(`Ignition failed: ${error.message}`);
            process.exit(1);
        }
    });
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
//# sourceMappingURL=ignite.js.map