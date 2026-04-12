#!/usr/bin/env node
/**
 * AI Chat Command - Manage AI chat UI interfaces for Hestia
 *
 * Provides commands for installing, configuring, and managing
 * optional AI chat UIs that connect to Hestia's AI backend.
 *
 * Commands:
 *   hestia ai:chat              - List available chat UIs
 *   hestia ai:chat:list         - Show installed and their status
 *   hestia ai:chat:install      - Install specific UI
 *   hestia ai:chat:remove       - Remove UI
 *   hestia ai:chat:start        - Start UI
 *   hestia ai:chat:stop         - Stop UI
 *   hestia ai:chat:open         - Open browser to UI
 *   hestia ai:chat:config       - Configure UI settings
 *   hestia ai:chat:logs         - Show logs
 *
 * Providers:
 *   - lobechat: Modern UI with plugin ecosystem
 *   - openwebui: Native Ollama integration
 *   - librechat: ChatGPT clone with multi-model support
 */

import { Command } from "commander";
import chalk from "chalk";
import { aiChatService } from "../lib/ai-chat-service.js";
import { logger } from "../lib/logger.js";
import type { AIChatProvider } from "../types.js";

// Valid provider names
const PROVIDERS: AIChatProvider[] = ["lobechat", "openwebui", "librechat"];

/**
 * Validate provider name
 */
function validateProvider(provider: string): provider is AIChatProvider {
  return PROVIDERS.includes(provider as AIChatProvider);
}

/**
 * Display provider information in formatted output
 */
function displayProviderInfo(providers: ReturnType<typeof aiChatService.listAvailable>): void {
  console.log(chalk.cyan("\nAvailable AI Chat UIs:\n"));
  
  for (const provider of providers) {
    console.log(chalk.bold.white(`${provider.displayName}`));
    console.log(chalk.gray(`  ID: ${provider.name}`));
    console.log(`  ${provider.description}`);
    console.log(chalk.yellow(`  Best for: ${provider.bestFor}`));
    console.log(chalk.gray(`  Port: ${provider.port}`));
    console.log(chalk.cyan("  Features:"));
    for (const feature of provider.features) {
      console.log(`    • ${feature}`);
    }
    console.log();
  }
}

/**
 * Display status table
 */
async function displayStatus(): Promise<void> {
  const statuses = await aiChatService.listInstalled();
  
  if (statuses.length === 0) {
    console.log(chalk.yellow("No AI chat UIs installed."));
    console.log(chalk.gray("Run 'hestia ai:chat' to see available options."));
    console.log(chalk.gray("Run 'hestia ai:chat:install <provider>' to install one."));
    return;
  }

  console.log(chalk.cyan("\nInstalled AI Chat UIs:\n"));
  
  for (const status of statuses) {
    const statusIcon = status.running 
      ? chalk.green("●") 
      : chalk.red("○");
    const healthIcon = status.health === "healthy" 
      ? chalk.green("✓")
      : status.health === "degraded"
      ? chalk.yellow("⚠")
      : chalk.red("✗");
    
    console.log(`${statusIcon} ${chalk.bold(status.name)}`);
    console.log(`  Status: ${status.running ? chalk.green("running") : chalk.red("stopped")}`);
    console.log(`  Health: ${healthIcon} ${status.health}`);
    console.log(`  URL: ${chalk.blue(status.url)}`);
    console.log(`  Port: ${status.port}`);
    console.log(`  Installed: ${status.installed ? chalk.green("yes") : chalk.red("no")}`);
    
    if (status.error) {
      console.log(chalk.red(`  Error: ${status.error}`));
    }
    console.log();
  }
}

/**
 * AI Chat command registration
 */
export function aiChatCommand(program: Command): void {
  const aiChat = program
    .command("ai:chat")
    .description("Manage AI chat UI interfaces")
    .action(async () => {
      console.log(chalk.cyan(`
╔════════════════════════════════════════════════════╗
║          AI Chat Interfaces for Hestia           ║
╚════════════════════════════════════════════════════╝
      `));
      
      const providers = aiChatService.listAvailable();
      displayProviderInfo(providers);
      
      console.log(chalk.gray("Commands:"));
      console.log(chalk.gray("  hestia ai:chat:list         - Show installed UIs and status"));
      console.log(chalk.gray("  hestia ai:chat:install      - Install a chat UI"));
      console.log(chalk.gray("  hestia ai:chat:remove       - Remove a chat UI"));
      console.log(chalk.gray("  hestia ai:chat:start        - Start a chat UI"));
      console.log(chalk.gray("  hestia ai:chat:stop         - Stop a chat UI"));
      console.log(chalk.gray("  hestia ai:chat:open         - Open chat UI in browser"));
      console.log(chalk.gray("  hestia ai:chat:config       - Configure a chat UI"));
      console.log(chalk.gray("  hestia ai:chat:logs         - Show chat UI logs"));
    });

  // List command - Show installed and status
  aiChat
    .command("list")
    .alias("ls")
    .description("Show installed AI chat UIs and their status")
    .action(async () => {
      try {
        await displayStatus();
      } catch (error) {
        logger.error(`Failed to list AI chat UIs: ${error}`);
        process.exit(1);
      }
    });

  // Install command
  aiChat
    .command("install <provider>")
    .description("Install a specific AI chat UI")
    .option("-p, --port <port>", "Custom port (optional)")
    .option("-y, --yes", "Skip confirmation", false)
    .action(async (provider: string, _options) => {
      if (!validateProvider(provider)) {
        console.log(chalk.red(`Invalid provider: ${provider}`));
        console.log(chalk.gray(`Valid providers: ${PROVIDERS.join(", ")}`));
        process.exit(1);
      }

      try {
        await aiChatService.install(provider);
      } catch (error) {
        logger.error(`Failed to install ${provider}: ${error}`);
        process.exit(1);
      }
    });

  // Remove command
  aiChat
    .command("remove <provider>")
    .alias("rm")
    .description("Remove an installed AI chat UI")
    .option("-f, --force", "Force removal without confirmation", false)
    .action(async (provider: string, _options) => {
      if (!validateProvider(provider)) {
        console.log(chalk.red(`Invalid provider: ${provider}`));
        console.log(chalk.gray(`Valid providers: ${PROVIDERS.join(", ")}`));
        process.exit(1);
      }

      try {
        await aiChatService.remove(provider);
      } catch (error) {
        logger.error(`Failed to remove ${provider}: ${error}`);
        process.exit(1);
      }
    });

  // Start command
  aiChat
    .command("start <provider>")
    .description("Start an AI chat UI service")
    .action(async (provider: string) => {
      if (!validateProvider(provider)) {
        console.log(chalk.red(`Invalid provider: ${provider}`));
        console.log(chalk.gray(`Valid providers: ${PROVIDERS.join(", ")}`));
        process.exit(1);
      }

      try {
        await aiChatService.start(provider);
        const url = await aiChatService.getUrl(provider);
        console.log(chalk.green(`\n${provider} is running!`));
        console.log(chalk.blue(`Access at: ${url}`));
        console.log(chalk.gray(`Run 'hestia ai:chat:open ${provider}' to open in browser`));
      } catch (error) {
        logger.error(`Failed to start ${provider}: ${error}`);
        process.exit(1);
      }
    });

  // Stop command
  aiChat
    .command("stop <provider>")
    .description("Stop an AI chat UI service")
    .action(async (provider: string) => {
      if (!validateProvider(provider)) {
        console.log(chalk.red(`Invalid provider: ${provider}`));
        console.log(chalk.gray(`Valid providers: ${PROVIDERS.join(", ")}`));
        process.exit(1);
      }

      try {
        await aiChatService.stop(provider);
      } catch (error) {
        logger.error(`Failed to stop ${provider}: ${error}`);
        process.exit(1);
      }
    });

  // Open command
  aiChat
    .command("open <provider>")
    .description("Open an AI chat UI in the browser")
    .action(async (provider: string) => {
      if (!validateProvider(provider)) {
        console.log(chalk.red(`Invalid provider: ${provider}`));
        console.log(chalk.gray(`Valid providers: ${PROVIDERS.join(", ")}`));
        process.exit(1);
      }

      try {
        const status = await aiChatService.getStatus(provider);
        if (!status.running) {
          console.log(chalk.yellow(`${provider} is not running.`));
          console.log(chalk.gray(`Run 'hestia ai:chat:start ${provider}' first.`));
          process.exit(1);
        }
        
        await aiChatService.open(provider);
      } catch (error) {
        logger.error(`Failed to open ${provider}: ${error}`);
        process.exit(1);
      }
    });

  // Config command
  aiChat
    .command("config <provider>")
    .description("Configure an AI chat UI")
    .option("-s, --set <key=value>", "Set configuration value", [])
    .option("-f, --file <path>", "Load configuration from JSON file")
    .action(async (provider: string, options) => {
      if (!validateProvider(provider)) {
        console.log(chalk.red(`Invalid provider: ${provider}`));
        console.log(chalk.gray(`Valid providers: ${PROVIDERS.join(", ")}`));
        process.exit(1);
      }

      try {
        let config: Record<string, unknown> = {};

        if (options.file) {
          const fs = await import("fs/promises");
          const content = await fs.readFile(options.file, "utf-8");
          config = JSON.parse(content);
        }

        // Parse key=value pairs
        if (options.set && options.set.length > 0) {
          for (const pair of options.set) {
            const [key, value] = pair.split("=");
            if (key && value) {
              // Try to parse as JSON, otherwise use as string
              try {
                config[key] = JSON.parse(value);
              } catch {
                config[key] = value;
              }
            }
          }
        }

        await aiChatService.configure(provider, config);
        console.log(chalk.green(`Configuration updated for ${provider}`));
      } catch (error) {
        logger.error(`Failed to configure ${provider}: ${error}`);
        process.exit(1);
      }
    });

  // Logs command
  aiChat
    .command("logs <provider>")
    .description("Show logs for an AI chat UI")
    .option("-f, --follow", "Follow logs (tail -f mode)", false)
    .option("-n, --lines <number>", "Number of lines to show", "100")
    .action(async (provider: string, options) => {
      if (!validateProvider(provider)) {
        console.log(chalk.red(`Invalid provider: ${provider}`));
        console.log(chalk.gray(`Valid providers: ${PROVIDERS.join(", ")}`));
        process.exit(1);
      }

      try {
        await aiChatService.logs(provider, options.follow);
      } catch (error) {
        logger.error(`Failed to get logs for ${provider}: ${error}`);
        process.exit(1);
      }
    });

  // Enable all command (hidden from help)
  aiChat
    .command("enable-all")
    .description("Enable all AI chat UIs (install and start all)")
    .action(async () => {
      try {
        await aiChatService.enableAll();
        console.log(chalk.green("\nAll AI chat UIs enabled!"));
        console.log(chalk.cyan("\nAccess URLs:"));
        for (const provider of PROVIDERS) {
          const url = await aiChatService.getUrl(provider);
          console.log(`  ${provider}: ${chalk.blue(url)}`);
        }
      } catch (error) {
        logger.error(`Failed to enable all AI chat UIs: ${error}`);
        process.exit(1);
      }
    });

  // Backend connect command (hidden from help)
  aiChat
    .command("connect-backend <backend>")
    .description("Connect AI chat UIs to AI backend")
    .action(async (backend: string) => {
      if (!["ollama", "openclaude", "openrouter"].includes(backend)) {
        console.log(chalk.red(`Invalid backend: ${backend}`));
        console.log(chalk.gray("Valid backends: ollama, openclaude, openrouter"));
        process.exit(1);
      }

      try {
        await aiChatService.connectToAI(backend as "ollama" | "openclaude" | "openrouter");
      } catch (error) {
        logger.error(`Failed to connect to ${backend}: ${error}`);
        process.exit(1);
      }
    });
}
