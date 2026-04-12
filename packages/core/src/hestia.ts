#!/usr/bin/env node
/**
 * Hestia CLI - Main entry point
 * Sovereign AI infrastructure management tool
 */

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

// Read package.json for version
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
    if (opts.debug) {
      logger.setLevel('debug');
    }
    if (opts.quiet) {
      logger.setLevel('silent');
    }
  });

// Add commands
// Core lifecycle
initCommand(program);
statusCommand(program);
igniteCommand(program);
extinguishCommand(program);

// Package management
addCommand(program);
removeCommand(program);
installCommand(program);
packageCommand(program);

// AI commands
aiCommand(program);
aiChatCommand(program);
assistantCommand(program);
agentsCommand(program);

// Operations (production/ops)
validateCommand(program);
healthCommand(program);
recoveryCommand(program);
testCommand(program);

// Hardware/OS management
hardwareCommand(program);
osCommand(program);
usbCommand(program);
provisionCommand(program);

// Network/Tunnel management
tunnelCommand(program);
proxyCommand(program);

// Optional Services management
servicesCommand(program);
dbViewerCommand(program);  // WhoDB database viewer integration

// Configuration
configCommand(program);

// Global error handling
process.on('unhandledRejection', (reason: any) => {
  logger.error(`Unhandled error: ${reason?.message || reason}`);
  if (logger.isVerbose()) {
    console.error(reason);
  }
  process.exit(1);
});

process.on('uncaughtException', (error: Error) => {
  logger.error(`Fatal error: ${error.message}`);
  if (logger.isVerbose()) {
    console.error(error);
  }
  process.exit(1);
});

// Parse and execute
program.parse();

// Show help if no command provided
if (!process.argv.slice(2).length) {
  console.log(chalk.cyan(`
╔════════════════════════════════════════════════════╗
║                                                    ║
║   ${chalk.bold.white('HESTIA')} - Sovereign AI Infrastructure          ║
║                                                    ║
║   Your data. Your AI. Your infrastructure.         ║
║                                                    ║
╚════════════════════════════════════════════════════╝
  `));
  program.outputHelp();
}
