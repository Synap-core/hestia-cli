#!/usr/bin/env node
/**
 * add command - Add a package to the hearth
 * Usage: hestia add <package-name> [version]
 */
import { getConfigValue, getCredential } from '../lib/config.js';
import { logger } from '../lib/logger.js';
import { withSpinner } from '../lib/spinner.js';
import { PackageService } from '../lib/package-service.js';
import chalk from 'chalk';
import inquirer from 'inquirer';
export function addCommand(program) {
    program
        .command('add <package-name> [version]')
        .description('Add a package to the hearth')
        .option('-c, --config <path>', 'Path to package configuration file')
        .option('-s, --source <source>', 'Package source (npm, docker, git, binary)')
        .option('-a, --auto-start', 'Start package immediately after install')
        .option('-e, --env <vars...>', 'Environment variables (KEY=value format)')
        .action(async (packageName, version, options) => {
        try {
            const config = await getConfigValue();
            const baseUrl = config.connectors?.controlPlane?.url || 'http://localhost:4000';
            const apiKey = await getCredential('apiKey') || '';
            const _api = { baseUrl, apiKey }; // API client placeholder
            const pkgService = new PackageService({ config, packagesDir: '/tmp/packages', logger });
            logger.header('ADDING PACKAGE');
            logger.info(`Package: ${chalk.cyan(packageName)}`);
            logger.info(`Version: ${chalk.cyan(version || 'latest')}`);
            logger.newline();
            // Check if package already exists
            const existingPackages = [];
            const existing = existingPackages.find((p) => p.name === packageName);
            if (existing) {
                logger.warn(`Package '${packageName}' is already installed (version ${existing.version})`);
                const { action } = await inquirer.prompt([{
                        type: 'list',
                        name: 'action',
                        message: 'What would you like to do?',
                        choices: [
                            { name: 'Update to new version', value: 'update' },
                            { name: 'Reinstall current version', value: 'reinstall' },
                            { name: 'Cancel', value: 'cancel' },
                        ],
                    }]);
                if (action === 'cancel') {
                    logger.info('Add cancelled');
                    return;
                }
                if (action === 'update' && !version) {
                    const { newVersion } = await inquirer.prompt([{
                            type: 'input',
                            name: 'newVersion',
                            message: 'Enter version to update to:',
                            default: 'latest',
                        }]);
                    version = newVersion;
                }
            }
            // Load package configuration
            let packageConfig = {};
            if (options.config) {
                const fs = await import('fs/promises');
                const configContent = await fs.readFile(options.config, 'utf-8');
                packageConfig = JSON.parse(configContent);
            }
            // Parse environment variables
            const envVars = {};
            if (options.env) {
                for (const env of options.env) {
                    const [key, ...valueParts] = env.split('=');
                    if (key && valueParts.length > 0) {
                        envVars[key] = valueParts.join('=');
                    }
                }
            }
            // Install the package
            await withSpinner(`Installing ${packageName}...`, async () => {
                await pkgService.install({
                    name: packageName,
                    version: version || 'latest',
                    source: { type: options.source || 'npm', url: packageName },
                    config: envVars,
                });
            }, `${packageName} installed successfully`);
            // Auto-start if requested
            if (options.autoStart) {
                await withSpinner(`Starting ${packageName}...`, () => pkgService.start(packageName), `${packageName} started`);
            }
            logger.newline();
            logger.success(`Package ${packageName} added to hearth! 📦`);
            if (!options.autoStart) {
                logger.info(`Run ${chalk.cyan(`hestia ignite ${packageName}`)} to start it`);
            }
        }
        catch (error) {
            logger.error(`Failed to add package: ${error.message}`);
            process.exit(1);
        }
    });
}
//# sourceMappingURL=add.js.map