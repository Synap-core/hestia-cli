/**
 * add command - Add a package to the hearth
 * Usage: hestia add <package-name> [version]
 */

import { Command } from 'commander';
import { getConfig } from '../lib/config.js';
import { ApiClient } from '../lib/api-client.js';
import { logger } from '../lib/logger.js';
import { withSpinner } from '../lib/spinner.js';
import { PackageService } from '../lib/package-service.js';
import chalk from 'chalk';
import inquirer from 'inquirer';

interface AddOptions {
  config?: string;
  version?: string;
  source?: string;
  autoStart?: boolean;
  env?: string[];
}

export function addCommand(program: Command): void {
  program
    .command('add <package-name> [version]')
    .description('Add a package to the hearth')
    .option('-c, --config <path>', 'Path to package configuration file')
    .option('-s, --source <source>', 'Package source (npm, docker, git, binary)')
    .option('-a, --auto-start', 'Start package immediately after install')
    .option('-e, --env <vars...>', 'Environment variables (KEY=value format)')
    .action(async (packageName: string, version: string | undefined, options: AddOptions) => {
      try {
        const config = await getConfig();
        const api = new ApiClient(config);
        const pkgService = new PackageService(config);

        logger.header('ADDING PACKAGE');
        logger.info(`Package: ${chalk.cyan(packageName)}`);
        logger.info(`Version: ${chalk.cyan(version || 'latest')}`);
        logger.newline();

        // Check if package already exists
        const existingPackages = await api.listPackages({});
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
        let packageConfig: any = {};
        if (options.config) {
          const fs = await import('fs/promises');
          const configContent = await fs.readFile(options.config, 'utf-8');
          packageConfig = JSON.parse(configContent);
        }

        // Parse environment variables
        const envVars: Record<string, string> = {};
        if (options.env) {
          for (const env of options.env) {
            const [key, ...valueParts] = env.split('=');
            if (key && valueParts.length > 0) {
              envVars[key] = valueParts.join('=');
            }
          }
        }

        // Install the package
        await withSpinner(
          `Installing ${packageName}...`,
          async () => {
            await pkgService.install({
              name: packageName,
              version: version || 'latest',
              source: (options.source as any) || 'npm',
              config: packageConfig,
              env: envVars,
            });
          },
          `${packageName} installed successfully`
        );

        // Register with API
        await withSpinner(
          'Registering package with hearth...',
          () => api.registerPackage({
            name: packageName,
            version: version || 'latest',
            packageType: (options.source as any) || 'npm',
            config: packageConfig,
          }),
          'Package registered'
        );

        // Auto-start if requested
        if (options.autoStart) {
          await withSpinner(
            `Starting ${packageName}...`,
            () => api.startPackage(packageName),
            `${packageName} started`
          );
        }

        logger.newline();
        logger.success(`Package ${packageName} added to hearth! 📦`);

        if (!options.autoStart) {
          logger.info(`Run ${chalk.cyan(`hestia ignite ${packageName}`)} to start it`);
        }

      } catch (error: any) {
        logger.error(`Failed to add package: ${error.message}`);
        process.exit(1);
      }
    });
}
