/**
 * config command - View and edit Hestia configuration
 * Usage: hestia config [key] [value]
 */

import { Command } from 'commander';
import { getConfig, getCredentials, updateConfig, UserConfig, Credentials, ConfigPath } from '../lib/config.js';
import { logger } from '../lib/logger.js';
import chalk from 'chalk';
import inquirer from 'inquirer';

interface ConfigOptions {
  local?: boolean;
  global?: boolean;
  json?: boolean;
  edit?: boolean;
}

export function configCommand(program: Command): void {
  const configCmd = program
    .command('config')
    .description('View and edit Hestia configuration')
    .option('-l, --local', 'Use local configuration (.hestia/config.yaml)')
    .option('-g, --global', 'Use global configuration (~/.hestia/config.yaml)')
    .option('-j, --json', 'Output as JSON')
    .option('-e, --edit', 'Open in editor')
    .action(async (options: ConfigOptions) => {
      try {
        const config = await getConfig();

        if (options.edit) {
          // Open in default editor
          const { spawn } = await import('child_process');
          const editor = process.env.EDITOR || 'vi';
          spawn(editor, [ConfigPath], { stdio: 'inherit' });
          return;
        }

        if (options.json) {
          console.log(JSON.stringify(config, null, 2));
          return;
        }

        // Display configuration
        logger.header('HESTIA CONFIGURATION');
        displayConfig(config);

      } catch (error: any) {
        logger.error(`Failed to load configuration: ${error.message}`);
        process.exit(1);
      }
    });

  // Subcommand: get
  configCmd
    .command('get <key>')
    .description('Get a configuration value')
    .action(async (key: string) => {
      try {
        const config = await getConfig();
        const value = getNestedValue(config, key);

        if (value === undefined) {
          logger.error(`Key '${key}' not found`);
          process.exit(1);
        }

        if (typeof value === 'object') {
          console.log(JSON.stringify(value, null, 2));
        } else {
          console.log(value);
        }
      } catch (error: any) {
        logger.error(`Failed to get value: ${error.message}`);
        process.exit(1);
      }
    });

  // Subcommand: set
  configCmd
    .command('set <key> <value>')
    .description('Set a configuration value')
    .option('-s, --secret', 'Store as secret (in credentials file)')
    .action(async (key: string, value: string, options: { secret?: boolean }) => {
      try {
        let parsedValue: any = value;

        // Try to parse as JSON
        try {
          parsedValue = JSON.parse(value);
        } catch {
          // Keep as string
        }

        if (options.secret) {
          // Store in credentials
          const credentials = await getCredentials();
          setNestedValue(credentials, key, parsedValue);
          await updateConfig(credentials, 'credentials');
          logger.success(`Secret '${key}' set successfully`);
        } else {
          // Store in config
          const config = await getConfig();
          setNestedValue(config, key, parsedValue);
          await updateConfig(config);
          logger.success(`Configuration '${key}' set to: ${JSON.stringify(parsedValue)}`);
        }
      } catch (error: any) {
        logger.error(`Failed to set value: ${error.message}`);
        process.exit(1);
      }
    });

  // Subcommand: list
  configCmd
    .command('list')
    .description('List all configuration values')
    .option('-s, --show-secrets', 'Show secret values (use with caution)')
    .action(async (options: { showSecrets?: boolean }) => {
      try {
        const config = await getConfig();
        const credentials = await getCredentials();

        logger.header('CONFIGURATION VALUES');
        displayFlatConfig(config, 'config');

        if (options.showSecrets) {
          logger.newline();
          logger.header('CREDENTIALS (SECRETS)');
          displayFlatConfig(credentials, 'secret');
        } else {
          logger.newline();
          logger.info(`Use ${chalk.cyan('--show-secrets')} to display credential values`);
        }
      } catch (error: any) {
        logger.error(`Failed to list configuration: ${error.message}`);
        process.exit(1);
      }
    });

  // Subcommand: wizard
  configCmd
    .command('wizard')
    .description('Interactive configuration wizard')
    .action(async () => {
      try {
        logger.header('CONFIGURATION WIZARD');
        logger.info('This wizard will help you set up Hestia configuration\n');

        const answers = await inquirer.prompt([
          {
            type: 'input',
            name: 'hearthId',
            message: 'Hearth ID (unique identifier for this node):',
            default: 'hearth-001',
          },
          {
            type: 'input',
            name: 'synapBackendUrl',
            message: 'Synap Backend URL:',
            default: 'http://localhost:4000',
          },
          {
            type: 'input',
            name: 'apiKey',
            message: 'API Key (leave blank to set later):',
          },
          {
            type: 'input',
            name: 'packagesDirectory',
            message: 'Packages directory:',
            default: '~/.hestia/packages',
          },
          {
            type: 'list',
            name: 'logLevel',
            message: 'Log level:',
            choices: ['debug', 'info', 'warn', 'error', 'silent'],
            default: 'info',
          },
          {
            type: 'confirm',
            name: 'autoUpdate',
            message: 'Enable automatic package updates?',
            default: true,
          },
          {
            type: 'confirm',
            name: 'autoStart',
            message: 'Auto-start packages after installation?',
            default: false,
          },
        ]);

        // Build config from answers
        const config: Partial<UserConfig> = {
          hearthId: answers.hearthId,
          synapBackendUrl: answers.synapBackendUrl,
          packagesDirectory: answers.packagesDirectory,
          logLevel: answers.logLevel,
          autoUpdate: answers.autoUpdate,
          autoStart: answers.autoStart,
        };

        // Save config
        await updateConfig(config as UserConfig);

        // Save API key to credentials if provided
        if (answers.apiKey) {
          const credentials: Credentials = { apiKey: answers.apiKey };
          await updateConfig(credentials, 'credentials');
        }

        logger.newline();
        logger.success('Configuration saved successfully! 🎉');
        logger.info(`Configuration file: ${chalk.cyan(ConfigPath)}`);

      } catch (error: any) {
        logger.error(`Wizard failed: ${error.message}`);
        process.exit(1);
      }
    });
}

function displayConfig(config: UserConfig): void {
  logger.section('Core Settings');
  logger.info(`Hearth ID: ${chalk.cyan(config.hearthId || 'Not set')}`);
  logger.info(`Backend URL: ${chalk.cyan(config.synapBackendUrl || 'Not set')}`);
  logger.info(`Packages Dir: ${chalk.cyan(config.packagesDirectory || '~/.hestia/packages')}`);
  logger.info(`Log Level: ${chalk.cyan(config.logLevel || 'info')}`);

  logger.newline();
  logger.section('Behavior');
  logger.info(`Auto Update: ${config.autoUpdate ? chalk.green('Yes') : chalk.gray('No')}`);
  logger.info(`Auto Start: ${config.autoStart ? chalk.green('Yes') : chalk.gray('No')}`);
  logger.info(`Backup Enabled: ${config.backupEnabled ? chalk.green('Yes') : chalk.gray('No')}`);

  if (config.intelligenceProvider) {
    logger.newline();
    logger.section('Intelligence Provider');
    logger.info(`Provider: ${chalk.cyan(config.intelligenceProvider.providerType)}`);
    logger.info(`Endpoint: ${chalk.cyan(config.intelligenceProvider.endpointUrl)}`);
    logger.info(`Model: ${chalk.cyan(config.intelligenceProvider.model)}`);
  }
}

function getNestedValue(obj: any, path: string): any {
  return path.split('.').reduce((current, key) => current?.[key], obj);
}

function setNestedValue(obj: any, path: string, value: any): void {
  const keys = path.split('.');
  const lastKey = keys.pop()!;
  const target = keys.reduce((current, key) => {
    if (!(key in current)) current[key] = {};
    return current[key];
  }, obj);
  target[lastKey] = value;
}

function displayFlatConfig(obj: any, prefix: string, parentKey = ''): void {
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = parentKey ? `${parentKey}.${key}` : key;
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      displayFlatConfig(value, prefix, fullKey);
    } else {
      const displayValue = prefix === 'secret'
        ? chalk.gray('[REDACTED]')
        : chalk.cyan(JSON.stringify(value));
      logger.info(`${fullKey}: ${displayValue}`);
    }
  }
}
