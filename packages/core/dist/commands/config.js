/**
 * config command - View and edit Hestia configuration
 * Usage: hestia config [key] [value]
 */
import { getConfigValue, updateConfig, getConfigPaths, getCredentials } from '../lib/config.js';
import { logger } from '../lib/logger.js';
import chalk from 'chalk';
import inquirer from 'inquirer';
export function configCommand(program) {
    const configCmd = program
        .command('config')
        .description('View and edit Hestia configuration')
        .option('-l, --local', 'Use local configuration (.hestia/config.yaml)')
        .option('-g, --global', 'Use global configuration (~/.hestia/config.yaml)')
        .option('-j, --json', 'Output as JSON')
        .option('-e, --edit', 'Open in editor')
        .action(async (options) => {
        try {
            const config = await getConfigValue();
            if (options.edit) {
                // Open in default editor
                const { spawn } = await import('child_process');
                const editor = process.env.EDITOR || 'vi';
                const paths = getConfigPaths();
                spawn(editor, [paths.userConfig], { stdio: 'inherit' });
                return;
            }
            if (options.json) {
                console.log(JSON.stringify(config, null, 2));
                return;
            }
            // Display configuration
            logger.header('HESTIA CONFIGURATION');
            displayConfig(config);
        }
        catch (error) {
            logger.error(`Failed to load configuration: ${error.message}`);
            process.exit(1);
        }
    });
    // Subcommand: get
    configCmd
        .command('get <key>')
        .description('Get a configuration value')
        .action(async (key) => {
        try {
            const config = await getConfigValue();
            const value = getNestedValue(config, key);
            if (value === undefined) {
                logger.error(`Key '${key}' not found`);
                process.exit(1);
            }
            if (typeof value === 'object') {
                console.log(JSON.stringify(value, null, 2));
            }
            else {
                console.log(value);
            }
        }
        catch (error) {
            logger.error(`Failed to get value: ${error.message}`);
            process.exit(1);
        }
    });
    // Subcommand: set
    configCmd
        .command('set <key> <value>')
        .description('Set a configuration value')
        .option('-s, --secret', 'Store as secret (in credentials file)')
        .action(async (key, value, options) => {
        try {
            let parsedValue = value;
            // Try to parse as JSON
            try {
                parsedValue = JSON.parse(value);
            }
            catch {
                // Keep as string
            }
            if (options.secret) {
                // Store in credentials
                const credentials = await getCredentials();
                setNestedValue(credentials, key, parsedValue);
                await updateConfig(credentials, 'credentials');
                logger.success(`Secret '${key}' set successfully`);
            }
            else {
                // Store in config
                const config = await getConfigValue();
                setNestedValue(config, key, parsedValue);
                await updateConfig(config);
                logger.success(`Configuration '${key}' set to: ${JSON.stringify(parsedValue)}`);
            }
        }
        catch (error) {
            logger.error(`Failed to set value: ${error.message}`);
            process.exit(1);
        }
    });
    // Subcommand: list
    configCmd
        .command('list')
        .description('List all configuration values')
        .option('-s, --show-secrets', 'Show secret values (use with caution)')
        .action(async (options) => {
        try {
            const config = await getConfigValue();
            const credentials = await getCredentials();
            logger.header('CONFIGURATION VALUES');
            displayFlatConfig(config, 'config');
            if (options.showSecrets) {
                logger.newline();
                logger.header('CREDENTIALS (SECRETS)');
                displayFlatConfig(credentials, 'secret');
            }
            else {
                logger.newline();
                logger.info(`Use ${chalk.cyan('--show-secrets')} to display credential values`);
            }
        }
        catch (error) {
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
            const config = {
                hearth: {
                    id: answers.hearthId,
                    name: answers.hearthId,
                    role: 'primary',
                },
                connectors: {
                    controlPlane: {
                        enabled: true,
                        url: answers.synapBackendUrl,
                    },
                },
            };
            // Save config
            await updateConfig(config);
            // Note: API key should be saved to credentials file separately
            logger.newline();
            logger.success('Configuration saved successfully! 🎉');
            const paths = getConfigPaths();
            logger.info(`Configuration file: ${chalk.cyan(paths.userConfig)}`);
        }
        catch (error) {
            logger.error(`Wizard failed: ${error.message}`);
            process.exit(1);
        }
    });
}
function displayConfig(config) {
    logger.section('Core Settings');
    logger.info(`Hearth ID: ${chalk.cyan(config.hearth?.id || 'Not set')}`);
    logger.info(`Hearth Name: ${chalk.cyan(config.hearth?.name || 'Not set')}`);
    logger.info(`Backend URL: ${chalk.cyan(config.connectors?.controlPlane?.url || 'Not set')}`);
    logger.newline();
    logger.section('Behavior');
    logger.info(`Reverse Proxy: ${chalk.cyan(config.reverseProxy || 'nginx')}`);
    if (config.intelligence) {
        logger.newline();
        logger.section('Intelligence Provider');
        logger.info(`Provider: ${chalk.cyan(config.intelligence.provider)}`);
        logger.info(`Endpoint: ${chalk.cyan(config.intelligence.endpoint || 'Not set')}`);
        logger.info(`Model: ${chalk.cyan(config.intelligence.model)}`);
    }
}
function getNestedValue(obj, path) {
    return path.split('.').reduce((current, key) => current?.[key], obj);
}
function setNestedValue(obj, path, value) {
    const keys = path.split('.');
    const lastKey = keys.pop();
    const target = keys.reduce((current, key) => {
        if (!(key in current))
            current[key] = {};
        return current[key];
    }, obj);
    target[lastKey] = value;
}
function displayFlatConfig(obj, prefix, parentKey = '') {
    for (const [key, value] of Object.entries(obj)) {
        const fullKey = parentKey ? `${parentKey}.${key}` : key;
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            displayFlatConfig(value, prefix, fullKey);
        }
        else {
            const displayValue = prefix === 'secret'
                ? chalk.gray('[REDACTED]')
                : chalk.cyan(JSON.stringify(value));
            logger.info(`${fullKey}: ${displayValue}`);
        }
    }
}
//# sourceMappingURL=config.js.map