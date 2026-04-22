import { Command } from 'commander';
import { openclaw, OpenClawService, type MCPConfig, type OpenClawConfig } from './lib/openclaw.js';
import { installCommand } from './commands/install.js';
import { startCommand } from './commands/start.js';
import { stopCommand } from './commands/stop.js';
import { mcpCommand } from './commands/mcp.js';
import { messagingCommand } from './commands/messaging.js';
import { voiceCommand } from './commands/voice.js';

// Re-export types and classes
export { openclaw, OpenClawService };
export type { MCPConfig, OpenClawConfig };

// Export commands
export { installCommand, startCommand, stopCommand, mcpCommand, messagingCommand, voiceCommand };

/**
 * Register Arms leaf commands on an existing `eve arms` Commander node
 */
export function registerArmsCommands(arms: Command): void {
  installCommand(arms);
  startCommand(arms);
  stopCommand(arms);
  mcpCommand(arms);
  messagingCommand(arms);
  voiceCommand(arms);

  arms
    .command('status')
    .description('Check OpenClaw status')
    .action(async () => {
      try {
        const status = await openclaw.getStatus();
        
        console.log('🦾 Arms Status:\n');
        console.log(`  Running: ${status.running ? '✅ Yes' : '❌ No'}`);
        console.log(`  URL: ${status.url}`);
        console.log(`  Model: ${status.model}`);
      } catch (error) {
        console.error('❌ Failed to get status:', error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });
}

/** @deprecated Use registerArmsCommands on the `arms` subcommand */
export function registerCommands(program: Command): void {
  const arms = program.command('arms').description('Manage OpenClaw AI assistant and MCP servers');
  registerArmsCommands(arms);
}

