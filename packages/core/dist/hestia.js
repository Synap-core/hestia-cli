#!/usr/bin/env node
/**
 * Hestia CLI - Main entry point
 * Sovereign AI infrastructure management tool
 */
// @ts-nocheck
import { Command } from 'commander';
import { logger } from './lib/utils/index';
import { initCommand, statusCommand, igniteCommand, extinguishCommand, addCommand, removeCommand, configCommand, packageCommand, installCommand, aiCommand, aiChatCommand, validateCommand, healthCommand, testCommand, recoveryCommand, hardwareCommand, osCommand, usbCommand, provisionCommand, tunnelCommand, servicesCommand, dbViewerCommand } from './commands/index.js';
import chalk from 'chalk';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf-8'));
const program = new Command();
program
    .name('hestia')
    .description('Sovereign AI infrastructure management')
    .version(packageJson.version, '-v, --version', 'Show version')
    .option('-d, --debug', 'Enable debug logging', () => logger.setLevel('debug'))
    .option('-q, --quiet', 'Suppress output', () => logger.setLevel('silent'))
    .option('--config <path>', 'Path to config file')
    .option('--hearth <id>', 'Target hearth ID')
    .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.debug)
        logger.setLevel('debug');
    if (opts.quiet)
        logger.setLevel('silent');
});
initCommand(program);
statusCommand(program);
igniteCommand(program);
extinguishCommand(program);
addCommand(program);
removeCommand(program);
installCommand(program);
packageCommand(program);
aiCommand(program);
aiChatCommand(program);
validateCommand(program);
healthCommand(program);
recoveryCommand(program);
testCommand(program);
hardwareCommand(program);
osCommand(program);
usbCommand(program);
provisionCommand(program);
tunnelCommand(program);
servicesCommand(program);
dbViewerCommand(program);
configCommand(program);
process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled error: ' + (reason?.message || reason));
    if (logger.isVerbose())
        console.error(reason);
    process.exit(1);
});
process.on('uncaughtException', (error) => {
    logger.error('Fatal error: ' + error.message);
    if (logger.isVerbose())
        console.error(error);
    process.exit(1);
});
program.parse();
if (!process.argv.slice(2).length) {
    console.log(chalk.cyan('\nHESTIA - Sovereign AI Infrastructure\n\nYour data. Your AI. Your infrastructure.\n'));
    program.outputHelp();
}
//# sourceMappingURL=hestia.js.map