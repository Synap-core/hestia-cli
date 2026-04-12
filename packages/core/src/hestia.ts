#!/usr/bin/env node
/**
 * Hestia CLI - Main entry point
 * Sovereign AI infrastructure management tool
 */
// @ts-nocheck

import { Command } from 'commander';
import { logger } from './lib/logger.js';
import { initCommand } from './commands/init.js';
import { statusCommand } from './commands/status.js';
import { igniteCommand } from './commands/ignite.js';
import { extinguishCommand } from './commands/extinguish.js';
import { addCommand } from './commands/add.js';
import { removeCommand } from './commands/remove.js';
import { configCommand } from './commands/config.js';
import { packageCommand } from './commands/package.js';
import { installCommand } from './commands/install.js';
import { aiCommand } from './commands/ai.js';
import { aiChatCommand } from './commands/ai-chat.js';
import { assistantCommand } from './commands/assistant.js';
import { agentsCommand } from './commands/agents.js';
import { validateCommand } from './commands/validate.js';
import { healthCommand } from './commands/health.js';
import { testCommand } from './commands/test.js';
import { recoveryCommand } from './commands/recovery.js';
import { hardwareCommand } from './commands/hardware.js';
import { osCommand } from './commands/os.js';
import { usbCommand } from './commands/usb.js';
import { provisionCommand } from './commands/provision.js';
import { tunnelCommand } from './commands/tunnel.js';
import { proxyCommand } from './commands/proxy.js';
import { servicesCommand } from './commands/services.js';
import { dbViewerCommand } from './commands/db-viewer.js';
import chalk from 'chalk';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const packageJson = JSON.parse(
  readFileSync(join(__dirname, '../package.json'), 'utf-8')
);

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
    if (opts.debug) logger.setLevel('debug');
    if (opts.quiet) logger.setLevel('silent');
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
assistantCommand(program);
agentsCommand(program);
validateCommand(program);
healthCommand(program);
recoveryCommand(program);
testCommand(program);
hardwareCommand(program);
osCommand(program);
usbCommand(program);
provisionCommand(program);
tunnelCommand(program);
proxyCommand(program);
servicesCommand(program);
dbViewerCommand(program);
configCommand(program);

process.on('unhandledRejection', (reason: any) => {
  logger.error('Unhandled error: ' + (reason?.message || reason));
  if (logger.isVerbose()) console.error(reason);
  process.exit(1);
});

process.on('uncaughtException', (error: Error) => {
  logger.error('Fatal error: ' + error.message);
  if (logger.isVerbose()) console.error(error);
  process.exit(1);
});

program.parse();

if (!process.argv.slice(2).length) {
  console.log(chalk.cyan('\nHESTIA - Sovereign AI Infrastructure\n\nYour data. Your AI. Your infrastructure.\n'));
  program.outputHelp();
}
