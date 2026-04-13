#!/usr/bin/env node
/**
 * ai command - OpenClaude integration for Hestia
 *
 * Provides subcommands for managing OpenClaude AI coding agent:
 * - ai (default): Start OpenClaude interactively
 * - ai:status: Show OpenClaude status
 * - ai:configure: Configure AI provider
 * - ai:stop: Stop OpenClaude
 * - ai:mcp: Manage MCP servers
 * - ai:setup: First-time setup
 */

import { Command } from 'commander';
import { openclaudeService } from '../lib/services/openclaude-service.js';
import { logger, spinner } from '../lib/utils/index.js';
import { stateManager } from '../lib/domains/services/lib/state-manager.js';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { promisify } from 'util';
import { exec } from 'child_process';
import { readFile } from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

const execAsync = promisify(exec);

// ============================================================================
// Types
// ============================================================================

interface AIStatusOptions {
  json?: boolean;
}

interface AISetupOptions {
  force?: boolean;
  unattended?: boolean;
}

interface ProviderConfig {
  provider: "ollama" | "openrouter" | "anthropic" | "openai" | "custom";
  model: string;
  endpoint?: string;
  apiKey?: string;
  temperature?: number;
  maxTokens?: number;
}

interface MCPInstalledServer {
  name: string;
  enabled: boolean;
  command: string;
  args: string[];
  transport: "stdio" | "sse";
}

// ============================================================================
// Main Command
// ============================================================================

export function aiCommand(program: Command): void {
  // Default 'ai' command - Start OpenClaude interactively
  program
    .command('ai')
    .description('Start OpenClaude interactively')
    .option('--no-setup', 'Skip setup check')
    .action(async (options: { setup?: boolean }) => {
      try {
        logger.header('HESTIA AI - OPENCLAUDE');

        // Check if OpenClaude is installed
        if (options.setup !== false) {
          const isInstalled = await checkOpenClaudeInstalled();
          if (!isInstalled) {
            logger.info('OpenClaude is not installed. Running setup...');
            await runSetup({ force: false, unattended: false });
          }
        }

        // Sync Hestia config to OpenClaude
        logger.info('Syncing Hestia configuration to OpenClaude...');
        await syncHestiaToOpenClaude();

        // Start OpenClaude
        logger.info('Starting OpenClaude...');
        await openclaudeService.start();

        // Display helpful information
        logger.newline();
        logger.success('OpenClaude is running! 🚀');
        logger.info('Type your messages below or use Ctrl+C to exit');
        logger.newline();

        // Handle graceful shutdown
        setupGracefulShutdown();

        // Keep process alive and forward stdin
        process.stdin.setRawMode?.(true);
        process.stdin.resume();
        process.stdin.setEncoding('utf-8');

        process.stdin.on('data', (data: string) => {
          if (data === '\u0003') {
            // Ctrl+C
            logger.newline();
            gracefulShutdown();
          }
        });

        // Keep alive
        await new Promise(() => {});

      } catch (error: any) {
        logger.error(`Failed to start OpenClaude: ${error.message}`);
        process.exit(1);
      }
    });

  // ai:status - Show OpenClaude status
  program
    .command('ai:status')
    .description('Show OpenClaude status')
    .option('-j, --json', 'Output as JSON')
    .action(async (options: AIStatusOptions) => {
      try {
        const status = openclaudeService.getStatus();
        const providerConfig = await openclaudeService.getProviderConfig();
        const mcpServers = await openclaudeService.listMCPServers();

        if (options.json) {
          console.log(JSON.stringify({
            status,
            provider: providerConfig,
            mcpServers
          }, null, 2));
          return;
        }

        logger.header('OPENCLAUDE STATUS');

        // Running status
        const isRunning = status.isRunning;
        logger.info(`Status: ${isRunning ? chalk.green('● Running') : chalk.gray('○ Stopped')}`);

        if (isRunning) {
          logger.info(`PID: ${chalk.cyan(status.pid || 'N/A')}`);
          if (status.uptime) {
            logger.info(`Uptime: ${chalk.cyan(formatUptime(status.uptime))}`);
          }
        }

        // Provider info
        logger.newline();
        logger.section('Provider Configuration');
        if (providerConfig) {
          logger.info(`Provider: ${chalk.cyan(providerConfig.provider)}`);
          logger.info(`Model: ${chalk.cyan(providerConfig.model)}`);
          if (providerConfig.endpoint) {
            logger.info(`Endpoint: ${chalk.gray(providerConfig.endpoint)}`);
          }
        } else {
          logger.warn('No provider configured. Run `hestia ai:configure` to set up.');
        }

        // MCP Servers
        logger.newline();
        logger.section('MCP Servers');
        if (mcpServers.length === 0) {
          logger.info('No MCP servers installed.');
          logger.info(`Use ${chalk.cyan('hestia ai:mcp add')} to install servers.`);
        } else {
          const mcpTable = mcpServers.map((server: MCPInstalledServer) => ({
            NAME: server.name,
            TRANSPORT: server.transport,
            STATUS: server.enabled ? chalk.green('enabled') : chalk.gray('disabled'),
            COMMAND: `${server.command} ${server.args.join(' ')}`.slice(0, 40),
          }));
          logger.table(mcpTable);
        }

        // Recent Activity
        logger.newline();
        logger.section('Recent Activity');
        const activityLog = await loadActivityLog();
        if (activityLog.length === 0) {
          logger.info('No recent activity.');
        } else {
          const recent = activityLog.slice(-5).reverse();
          for (const entry of recent) {
            const timestamp = new Date(entry.timestamp).toLocaleTimeString();
            logger.info(`${chalk.gray(timestamp)} ${entry.type}: ${entry.details?.message || ''}`);
          }
        }

        // Errors
        if (status.errors.length > 0) {
          logger.newline();
          logger.section('Recent Errors');
          for (const error of status.errors.slice(-5)) {
            logger.error(error);
          }
        }

      } catch (error: any) {
        logger.error(`Failed to get status: ${error.message}`);
        process.exit(1);
      }
    });

  // ai:configure - Configure AI provider
  program
    .command('ai:configure')
    .description('Configure AI provider')
    .option('-p, --provider <provider>', 'Provider (ollama, openrouter, anthropic, openai)')
    .option('-m, --model <model>', 'Model name')
    .option('-k, --api-key <key>', 'API key')
    .option('-e, --endpoint <url>', 'API endpoint')
    .option('--temperature <temp>', 'Temperature (0-1)')
    .option('--max-tokens <tokens>', 'Max tokens')
    .action(async (options: {
      provider?: string;
      model?: string;
      apiKey?: string;
      endpoint?: string;
      temperature?: string;
      maxTokens?: string;
    }) => {
      try {
        logger.header('CONFIGURE AI PROVIDER');

        let config: ProviderConfig;

        // Interactive wizard if no options provided
        if (!options.provider) {
          config = await runProviderWizard();
        } else {
          config = {
            provider: options.provider as any,
            model: options.model || 'gpt-4',
            apiKey: options.apiKey,
            endpoint: options.endpoint,
            temperature: options.temperature ? parseFloat(options.temperature) : undefined,
            maxTokens: options.maxTokens ? parseInt(options.maxTokens, 10) : undefined,
          };
        }

        // Configure the provider
        spinner.start('configuring', 'Configuring provider...');
        await openclaudeService.configureProvider(config);
        spinner.succeed('configuring', 'Provider configured successfully');

        // Save to Hestia config via state manager
        logger.info('Syncing configuration to Hestia...');
        await syncConfigToHestia(config);

        logger.success('AI provider configured! 🎉');
        logger.info(`Provider: ${chalk.cyan(config.provider)}`);
        logger.info(`Model: ${chalk.cyan(config.model)}`);

        // Ask to restart if running
        const status = openclaudeService.getStatus();
        if (status.isRunning) {
          const { restart } = await inquirer.prompt([{
            type: 'confirm',
            name: 'restart',
            message: 'OpenClaude is running. Restart to apply changes?',
            default: true,
          }]);

          if (restart) {
            await openclaudeService.stop();
            await openclaudeService.start();
            logger.success('OpenClaude restarted with new configuration');
          }
        }

      } catch (error: any) {
        spinner.fail('configuring', `Configuration failed: ${error.message}`);
        logger.error(error.message);
        process.exit(1);
      }
    });

  // ai:stop - Stop OpenClaude
  program
    .command('ai:stop')
    .description('Stop OpenClaude')
    .option('-t, --timeout <ms>', 'Timeout in milliseconds', '10000')
    .action(async (options: { timeout: string }) => {
      try {
        logger.header('STOPPING OPENCLAUDE');

        const status = openclaudeService.getStatus();
        if (!status.isRunning) {
          logger.info('OpenClaude is not running.');
          return;
        }

        spinner.start('stopping', 'Stopping OpenClaude...');
        await openclaudeService.stop(parseInt(options.timeout, 10));
        spinner.succeed('stopping', 'OpenClaude stopped successfully');

      } catch (error: any) {
        spinner.fail('stopping', `Failed to stop OpenClaude: ${error.message}`);
        process.exit(1);
      }
    });

  // ai:mcp - Manage MCP servers
  program
    .command('ai:mcp <action>')
    .description('Manage MCP servers (list, add, remove, enable, disable)')
    .option('-n, --name <name>', 'Server name')
    .option('-t, --transport <type>', 'Transport type (stdio, sse)')
    .option('-c, --command <cmd>', 'Command for stdio transport')
    .option('-u, --url <url>', 'URL for SSE transport')
    .option('-j, --json', 'Output as JSON')
    .action(async (
      action: string,
      options: {
        name?: string;
        transport?: string;
        command?: string;
        url?: string;
        json?: boolean;
      }
    ) => {
      try {
        const validActions = ['list', 'add', 'remove', 'enable', 'disable'];

        if (!validActions.includes(action)) {
          logger.error(`Invalid action: ${action}`);
          logger.info(`Valid actions: ${validActions.join(', ')}`);
          process.exit(1);
        }

        switch (action) {
          case 'list': {
            const servers = await openclaudeService.listMCPServers();

            if (options.json) {
              console.log(JSON.stringify(servers, null, 2));
              return;
            }

            logger.header('MCP SERVERS');

            if (servers.length === 0) {
              logger.info('No MCP servers installed.');
              logger.info(`Use ${chalk.cyan('hestia ai:mcp add')} to install a server.`);
            } else {
              const tableData = servers.map((server: MCPInstalledServer) => ({
                NAME: server.name,
                TRANSPORT: server.transport,
                ENABLED: server.enabled ? chalk.green('✓') : chalk.gray('✗'),
                COMMAND: server.transport === 'stdio'
                  ? `${server.command} ${server.args.join(' ')}`.slice(0, 50)
                  : chalk.gray('N/A'),
              }));
              logger.table(tableData);
            }
            break;
          }

          case 'add': {
            logger.header('ADD MCP SERVER');

            const answers = await inquirer.prompt([
              {
                type: 'input',
                name: 'name',
                message: 'Server name:',
                default: options.name,
                when: !options.name,
              },
              {
                type: 'list',
                name: 'transport',
                message: 'Transport type:',
                choices: [
                  { name: 'stdio (local command)', value: 'stdio' },
                  { name: 'sse (server-sent events)', value: 'sse' },
                ],
                default: options.transport,
                when: !options.transport,
              },
              {
                type: 'input',
                name: 'command',
                message: 'Command (e.g., "npx", "node"):',
                default: options.command,
                when: (answers) => !options.command && (answers.transport === 'stdio' || options.transport === 'stdio'),
              },
              {
                type: 'input',
                name: 'args',
                message: 'Arguments (comma-separated):',
                default: '',
                filter: (input: string) => input.split(',').map((s) => s.trim()).filter(Boolean),
              },
              {
                type: 'input',
                name: 'url',
                message: 'Server URL:',
                default: options.url,
                when: (answers) => !options.url && (answers.transport === 'sse' || options.transport === 'sse'),
              },
            ]);

            const name = options.name || answers.name;
            const _transport = options.transport || answers.transport;
            const command = options.command || answers.command || 'npx';
            const args = answers.args || [];
            const url = options.url || answers.url;

            if (!name) {
              logger.error('Server name is required');
              process.exit(1);
            }

            spinner.start('add-mcp', `Installing MCP server: ${name}...`);

            await openclaudeService.installMCPServer(name, {
              name,
              command,
              args,
              url,
              env: {},
            });

            spinner.succeed('add-mcp', `MCP server '${name}' installed successfully`);
            break;
          }

          case 'remove': {
            const name = options.name;

            if (!name) {
              logger.error('Server name is required. Use --name <name>');
              process.exit(1);
            }

            spinner.start('remove-mcp', `Removing MCP server: ${name}...`);
            await openclaudeService.uninstallMCPServer(name);
            spinner.succeed('remove-mcp', `MCP server '${name}' removed successfully`);
            break;
          }

          case 'enable': {
            const name = options.name;

            if (!name) {
              logger.error('Server name is required. Use --name <name>');
              process.exit(1);
            }

            spinner.start('enable-mcp', `Enabling MCP server: ${name}...`);
            await openclaudeService.toggleMCPServer(name, true);
            spinner.succeed('enable-mcp', `MCP server '${name}' enabled`);
            break;
          }

          case 'disable': {
            const name = options.name;

            if (!name) {
              logger.error('Server name is required. Use --name <name>');
              process.exit(1);
            }

            spinner.start('disable-mcp', `Disabling MCP server: ${name}...`);
            await openclaudeService.toggleMCPServer(name, false);
            spinner.succeed('disable-mcp', `MCP server '${name}' disabled`);
            break;
          }
        }

      } catch (error: any) {
        spinner.fail('mcp-action', error.message);
        logger.error(error.message);
        process.exit(1);
      }
    });

  // ai:setup - First-time setup
  program
    .command('ai:setup')
    .description('Run first-time OpenClaude setup')
    .option('-f, --force', 'Force reinstall if already installed')
    .option('-u, --unattended', 'Unattended mode (no prompts)')
    .action(async (options: AISetupOptions) => {
      await runSetup(options);
    });
}

// ============================================================================
// Helper Functions
// ============================================================================

async function runSetup(options: AISetupOptions): Promise<void> {
  try {
    logger.header('HESTIA AI SETUP');

    const isInstalled = await checkOpenClaudeInstalled();

    if (isInstalled && !options.force) {
      logger.info('OpenClaude is already installed.');
      logger.info(`Use ${chalk.cyan('--force')} to reinstall.`);
      return;
    }

    if (isInstalled && options.force) {
      logger.warn('Force reinstall requested. This will overwrite existing configuration.');

      if (!options.unattended) {
        const { confirm } = await inquirer.prompt([{
          type: 'confirm',
          name: 'confirm',
          message: 'Continue with reinstall?',
          default: false,
        }]);

        if (!confirm) {
          logger.info('Setup cancelled.');
          return;
        }
      }
    }

    // Install OpenClaude
    spinner.start('install', 'Installing OpenClaude...');
    await installOpenClaude();
    spinner.succeed('install', 'OpenClaude installed successfully');

    // Configure default provider
    if (!options.unattended) {
      logger.newline();
      logger.info('Let\'s configure your AI provider:');
      const config = await runProviderWizard();

      spinner.start('config', 'Saving provider configuration...');
      await openclaudeService.configureProvider(config);
      spinner.succeed('config', 'Provider configuration saved');
    }

    // Install recommended MCP servers
    logger.newline();
    logger.info('Installing recommended MCP servers...');

    // Hestia MCP
    try {
      spinner.start('mcp-hearth', 'Installing hestia MCP server...');
      await openclaudeService.installMCPServer('hestia', {
        name: 'hestia',
        command: 'npx',
        args: ['-y', '@synap/mcp-hearth', 'start'],
        env: {},
      });
      spinner.succeed('mcp-hearth', 'hestia MCP server installed');
    } catch (error: any) {
      spinner.fail('mcp-hearth', `Failed to install hestia MCP: ${error.message}`);
    }

    // Synap MCP
    try {
      spinner.start('mcp-synap', 'Installing synap MCP server...');
      await openclaudeService.installMCPServer('synap', {
        name: 'synap',
        command: 'npx',
        args: ['-y', '@synap/mcp'],
        env: {},
      });
      spinner.succeed('mcp-synap', 'synap MCP server installed');
    } catch (error: any) {
      spinner.fail('mcp-synap', `Failed to install synap MCP: ${error.message}`);
    }

    logger.newline();
    logger.success('Setup complete! 🎉');
    logger.info('You can now start OpenClaude with:');
    logger.info(chalk.cyan('  hestia ai'));

  } catch (error: any) {
    spinner.fail('setup', `Setup failed: ${error.message}`);
    logger.error(error.message);
    process.exit(1);
  }
}

async function runProviderWizard(): Promise<{
  provider: 'ollama' | 'openrouter' | 'anthropic' | 'openai' | 'custom';
  model: string;
  apiKey?: string;
  endpoint?: string;
  temperature?: number;
  maxTokens?: number;
}> {
  const answers = await inquirer.prompt([
    {
      type: 'list',
      name: 'provider',
      message: 'Select AI provider:',
      choices: [
        { name: 'Ollama (local, free)', value: 'ollama' },
        { name: 'OpenRouter (multiple models)', value: 'openrouter' },
        { name: 'Anthropic (Claude)', value: 'anthropic' },
        { name: 'OpenAI (GPT)', value: 'openai' },
        { name: 'Custom', value: 'custom' },
      ],
    },
    {
      type: 'input',
      name: 'apiKey',
      message: 'API Key (leave blank if not needed):',
      when: (answers) => answers.provider !== 'ollama',
    },
    {
      type: 'input',
      name: 'endpoint',
      message: 'API Endpoint (optional):',
      when: (answers) => answers.provider !== 'ollama',
    },
    {
      type: 'input',
      name: 'model',
      message: 'Model:',
      default: (answers: any) => {
        const defaults: Record<string, string> = {
          ollama: 'llama3.1:8b',
          openrouter: 'anthropic/claude-3.5-sonnet',
          anthropic: 'claude-3-5-sonnet-20241022',
          openai: 'gpt-4',
          custom: 'custom-model',
        };
        return defaults[answers.provider];
      },
    },
    {
      type: 'number',
      name: 'temperature',
      message: 'Temperature (0-1, optional):',
      default: 0.7,
      min: 0,
      max: 1,
    },
    {
      type: 'number',
      name: 'maxTokens',
      message: 'Max tokens (optional):',
      default: 4096,
    },
  ]);

  return {
    provider: answers.provider,
    model: answers.model,
    apiKey: answers.apiKey || undefined,
    endpoint: answers.endpoint || undefined,
    temperature: answers.temperature,
    maxTokens: answers.maxTokens,
  };
}

async function checkOpenClaudeInstalled(): Promise<boolean> {
  try {
    await execAsync('which openclaude');
    return true;
  } catch {
    return false;
  }
}

async function installOpenClaude(): Promise<void> {
  try {
    // Try npm install first
    await execAsync('npm install -g @gitlawb/openclaude');
  } catch (error) {
    // Fallback to npx if global install fails
    logger.warn('Global install failed, trying with npx...');
    await execAsync('npx -y @gitlawb/openclaude --version');
  }
}

async function syncHestiaToOpenClaude(): Promise<void> {
  await stateManager.syncAll();
}

async function syncConfigToHestia(config: {
  provider: string;
  model: string;
  apiKey?: string;
  endpoint?: string;
  temperature?: number;
  maxTokens?: number;
}): Promise<void> {
  await stateManager.setNormalState({
    intelligence: {
      provider: config.provider as any,
      model: config.model,
      apiKey: config.apiKey,
      endpoint: config.endpoint,
      temperature: config.temperature,
      maxTokens: config.maxTokens,
    },
  });
}

async function loadActivityLog(): Promise<Array<{
  timestamp: string;
  type: string;
  details?: Record<string, any>;
}>> {
  try {
    const logPath = path.join(os.homedir(), '.openclaude', 'activity.log');
    const content = await readFile(logPath, 'utf-8');
    return content
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  return `${minutes}m ${seconds % 60}s`;
}

function setupGracefulShutdown(): void {
  process.on('SIGINT', gracefulShutdown);
  process.on('SIGTERM', gracefulShutdown);
}

async function gracefulShutdown(): Promise<void> {
  logger.newline();
  logger.info('Shutting down OpenClaude...');

  try {
    await openclaudeService.stop();
    logger.success('OpenClaude stopped. Goodbye! 👋');
  } catch (error: any) {
    logger.warn(`Error during shutdown: ${error.message}`);
  }

  process.exit(0);
}
