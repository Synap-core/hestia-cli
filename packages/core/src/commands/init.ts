#!/usr/bin/env node
// @ts-nocheck
/**
 * Hestia CLI - Init Command
 *
 * Initialize a new digital hearth.
 */

import { Command } from "commander";
import inquirer from "inquirer";
import { createInitialConfig, configExists, updateConfig } from "../lib/config.js";
import { checkPodHealth } from "../lib/api-client.js";
import { getOrCreateHestiaWorkspace } from "../lib/workspace-setup.js";
import type { IntelligenceConfig, OptionalServiceConfig } from "../types.js";
import { serviceManager } from "../lib/service-manager.js";

export const initCommand = new Command("init")
  .description("Initialize a new Hestia hearth")
  .option("--name <name>", "Hearth name")
  .option("--role <role>", "Hearth role (primary|backup)", "primary")
  .option("--domain <domain>", "Domain name")
  .option("--intelligence <provider>", "Intelligence provider (ollama|openrouter|anthropic|openai|custom)", "ollama")
  .option("--endpoint <url>", "Intelligence endpoint URL")
  .option("--model <model>", "Default model", "llama3.1:8b")
  .option("--pod-url <url>", "Synap Backend URL", "http://localhost:4000")
  .option("--api-key <key>", "Synap Data Pod API key (Bearer token)")
  .option("--skip-registration", "Skip registering with backend")
  .option("--quick", "Quick setup with defaults")
  .option("--ai-platform <platform>", "AI platform (opencode|openclaude|later)", "opencode")
  .action(async (options, command) => {
    const { verbose, dryRun } = command.parent?.opts() || {};
    const logger = {
      debug: verbose ? console.log : () => {},
      info: console.log,
      warn: console.warn,
      error: console.error,
    };

    logger.info("🔥 Welcome to Hestia — The Digital Hearth\n");

    // Check if already initialized
    if (await configExists()) {
      const { overwrite } = await inquirer.prompt([
        {
          type: "confirm",
          name: "overwrite",
          message: "Hestia is already initialized. Reinitialize?",
          default: false,
        },
      ]);

      if (!overwrite) {
        logger.info("Keeping existing configuration.");
        return;
      }
    }

    // Quick setup
    if (options.quick) {
      logger.info("Using quick setup with defaults...\n");

      const aiPlatform = "opencode";
      const config = await createInitialConfig({
        hearthName: options.name || "My Digital Hearth",
        role: options.role,
        domain: options.domain,
        intelligence: {
          provider: options.intelligence as IntelligenceConfig["provider"],
          endpoint: options.endpoint,
          model: options.model,
        },
        aiPlatform,
      });

      logger.info("\n✓ Hestia initialized successfully!");
      logger.info(`\nHearth ID: ${config.hearth.id}`);
      logger.info(`Name: ${config.hearth.name}`);
      logger.info(`Role: ${config.hearth.role}`);
      logger.info(`AI Platform: ${aiPlatform}`);
      
      // Platform-specific guidance
      if (aiPlatform === "opencode") {
        logger.info(`\n📝 OpenCode setup:`);
        logger.info(`   • Get your API key at: https://opencode.ai/api-keys`);
        logger.info(`   • Configure: hestia config set ai.platform.opencode.apiKey <your-key>`);
      } else if (aiPlatform === "openclaude") {
        logger.info(`\n🤖 OpenClaude setup:`);
        logger.info(`   • Get your API key at: https://openclaude.ai/settings/api-keys`);
        logger.info(`   • Configure: hestia config set ai.platform.openclaude.apiKey <your-key>`);
      } else if (aiPlatform === "later") {
        logger.info(`\n⏳ AI Platform setup:`);
        logger.info(`   • Choose OpenCode or OpenClaude when ready`);
        logger.info(`   • Configure: hestia config set ai.platform <opencode|openclaude>`);
      }
      
      logger.info(`\nNext steps:`);
      logger.info("  1. hestia ignite          # Start the hearth");
      logger.info("  2. hestia status          # Check status");
      logger.info("  3. hestia add gateway     # Add OpenClaw gateway");

      return;
    }

    // Interactive setup
    const answers = await inquirer.prompt([
      {
        type: "input",
        name: "name",
        message: "What would you like to name your hearth?",
        default: options.name || "My Digital Hearth",
        when: !options.name,
      },
      {
        type: "list",
        name: "role",
        message: "What is this hearth's role?",
        choices: [
          { name: "Primary — The main hearth", value: "primary" },
          { name: "Backup — Redundancy hearth", value: "backup" },
        ],
        default: options.role,
        when: () => !options.role,
      },
      {
        type: "input",
        name: "domain",
        message: "Domain name (optional):",
        default: options.domain,
        when: () => !options.domain,
      },
      {
        type: "list",
        name: "intelligenceProvider",
        message: "Choose your intelligence provider:",
        choices: [
          { name: "Ollama (local, default)", value: "ollama" },
          { name: "OpenRouter (multi-provider)", value: "openrouter" },
          { name: "Anthropic (Claude)", value: "anthropic" },
          { name: "OpenAI (GPT)", value: "openai" },
          { name: "Custom (OpenAI-compatible)", value: "custom" },
        ],
        default: options.intelligence,
      },
      {
        type: "input",
        name: "endpointUrl",
        message: "Intelligence endpoint URL:",
        default: (answers: { intelligenceProvider: string }) => {
          if (answers.intelligenceProvider === "ollama") {
            return "http://localhost:11434";
          }
          return "";
        },
        when: (answers: { intelligenceProvider: string }) =>
          answers.intelligenceProvider !== "openrouter" &&
          answers.intelligenceProvider !== "anthropic" &&
          answers.intelligenceProvider !== "openai" &&
          !options.endpoint,
      },
      {
        type: "input",
        name: "model",
        message: "Default model:",
        default: (answers: { intelligenceProvider: string }) => {
          switch (answers.intelligenceProvider) {
            case "ollama":
              return "llama3.1:8b";
            case "openrouter":
              return "anthropic/claude-3-opus";
            case "anthropic":
              return "claude-3-opus-20240229";
            case "openai":
              return "gpt-4";
            default:
              return "default";
          }
        },
        when: () => !options.model,
      },
      {
        type: "input",
        name: "podUrl",
        message: "Synap Backend URL:",
        default: options.podUrl || "http://localhost:4000",
      },
      {
        type: "checkbox",
        name: "optionalServices",
        message: "Enable optional services:",
        choices: [
          { name: "Reverse Proxy: Traefik (alternative to Nginx)", value: "traefik" },
          { name: "Remote Tunnel: Pangolin (for home servers)", value: "pangolin" },
          { name: "Database Viewer: WhoDB (web UI for database)", value: "whodb" },
          { name: "AI Chat UI: LobeChat (modern chat interface)", value: "lobechat" },
          { name: "AI Chat UI: Open WebUI (Ollama native)", value: "openwebui" },
          { name: "AI Chat UI: LibreChat (ChatGPT-like)", value: "librechat" },
        ],
        default: [],
      },
      {
        type: "list",
        name: "aiPlatform",
        message: "Which AI platform would you like to use?",
        choices: [
          { name: "OpenCode (recommended) - Claude Code IDE for development", value: "opencode" },
          { name: "OpenClaude - AI builder for creating apps", value: "openclaude" },
          { name: "I'll configure this later", value: "later" },
        ],
        default: "opencode",
      },
    ]);

    const config: {
      name: string;
      role: string;
      domain: string;
      intelligenceProvider: string;
      endpointUrl: string;
      model: string;
      podUrl: string;
      optionalServices: string[];
      aiPlatform: "opencode" | "openclaude" | "later";
    } = {
      name: options.name || (answers as unknown as { name: string }).name,
      role: options.role || (answers as unknown as { role: string }).role,
      domain: options.domain || (answers as unknown as { domain: string }).domain,
      intelligenceProvider: options.intelligence || (answers as unknown as { intelligenceProvider: string }).intelligenceProvider,
      endpointUrl: options.endpoint || (answers as unknown as { endpointUrl: string }).endpointUrl,
      model: options.model || (answers as unknown as { model: string }).model,
      podUrl: options.podUrl || (answers as unknown as { podUrl: string }).podUrl,
      optionalServices: (answers as unknown as { optionalServices: string[] }).optionalServices || [],
      aiPlatform: (answers as unknown as { aiPlatform: "opencode" | "openclaude" | "later" }).aiPlatform || "opencode",
    };

    logger.info("\n🔧 Creating your hearth...\n");

    if (dryRun) {
      logger.info("[DRY RUN] Would create configuration:");
      logger.info(JSON.stringify(config, null, 2));
      return;
    }

    // Check if backend is available
    logger.info("Checking Synap Backend...");
    const health = await checkPodHealth(config.podUrl);

    if (!health.healthy) {
      logger.warn(`\n⚠️  Synap Backend not available at ${config.podUrl}`);
      logger.warn(`   Error: ${health.error}`);
      logger.info("\nContinuing with local configuration only.");
      logger.info("You can register with the backend later.\n");
    } else {
      logger.info(`✓ Backend available (version: ${health.version})\n`);
    }

    // Create configuration
    let hestiaConfig = await createInitialConfig({
      hearthName: config.name,
      role: config.role as "primary" | "backup",
      domain: config.domain,
      intelligence: {
        provider: config.intelligenceProvider as IntelligenceConfig["provider"],
        endpoint: config.endpointUrl,
        model: config.model,
      },
      aiPlatform: config.aiPlatform,
    });

    // Setup optional services if selected
    if (config.optionalServices.length > 0) {
      logger.info("\n🔧 Setting up optional services...\n");

      const optionalServicesConfig: Record<string, OptionalServiceConfig> = {};

      for (const serviceName of config.optionalServices) {
        try {
          logger.info(`Installing ${serviceName}...`);
          await serviceManager.install(serviceName);
          await serviceManager.enable(serviceName);
          
          optionalServicesConfig[serviceName] = {
            enabled: true,
            installed: true,
            autoStart: true,
          };
          
          (logger as { success: (msg: string) => void }).success(`✓ ${serviceName} installed and enabled`);
        } catch (error) {
          logger.warn(`Failed to setup ${serviceName}: ${error instanceof Error ? error.message : String(error)}`);
          optionalServicesConfig[serviceName] = {
            enabled: false,
            installed: true,
            autoStart: false,
          };
        }
      }

      // Update config with optional services
      hestiaConfig = await updateConfig({
        optionalServices: {
          ...hestiaConfig.optionalServices,
          ...optionalServicesConfig,
        },
      });
    }

    // Create Hestia workspace on the pod if API key is available
    if (health.healthy && !options.skipRegistration) {
      // Resolve API key: flag > env > prompt
      let apiKey: string = options.apiKey || process.env.HESTIA_API_KEY || "";

      if (!apiKey) {
        const { apiKeyAnswer } = await inquirer.prompt([
          {
            type: "password",
            name: "apiKeyAnswer",
            message: "Synap Data Pod API key (leave blank to skip workspace setup):",
            default: "",
          },
        ]);
        apiKey = apiKeyAnswer.trim();
      }

      if (apiKey) {
        logger.info("\n🏗️  Setting up Hestia workspace on your data pod...");

        const wsResult = await getOrCreateHestiaWorkspace({
          podUrl: config.podUrl,
          apiKey,
        });

        if (wsResult.success) {
          hestiaConfig = await updateConfig({
            pod: {
              url: config.podUrl,
              apiKey,
              workspaceId: wsResult.workspaceId,
            },
          });
          logger.info(`✓ Workspace ready: ${wsResult.workspaceId}\n`);
        } else {
          logger.warn(`⚠️  Workspace setup failed: ${wsResult.error}`);
          logger.warn("   Run: hestia connect --api-key <key>  to retry later.\n");
        }
      } else {
        logger.info("\nℹ️  Skipping workspace setup (no API key provided).");
        logger.info("   Run: hestia connect --api-key <key>  when ready.\n");
      }
    }

    // Success!
    logger.info("\n✅ Hestia initialized successfully!\n");
    logger.info(`Hearth ID: ${hestiaConfig.hearth.id}`);
    logger.info(`Name: ${hestiaConfig.hearth.name}`);
    logger.info(`Role: ${hestiaConfig.hearth.role}`);
    if (hestiaConfig.pod?.workspaceId) {
      logger.info(`Workspace: ${hestiaConfig.pod.workspaceId}`);
      logger.info(`Pod: ${hestiaConfig.pod.url}`);
    }
    
    // AI Platform guidance
    if (hestiaConfig.aiPlatform === "opencode") {
      logger.info(`\n📝 OpenCode setup:`);
      logger.info(`   • Get your API key at: https://opencode.ai/api-keys`);
      logger.info(`   • Configure: hestia config set ai.platform.opencode.apiKey <your-key>`);
    } else if (hestiaConfig.aiPlatform === "openclaude") {
      logger.info(`\n🤖 OpenClaude setup:`);
      logger.info(`   • Get your API key at: https://openclaude.ai/settings/api-keys`);
      logger.info(`   • Configure: hestia config set ai.platform.openclaude.apiKey <your-key>`);
    } else if (hestiaConfig.aiPlatform === "later") {
      logger.info(`\n⏳ AI Platform setup:`);
      logger.info(`   • Choose OpenCode or OpenClaude when ready`);
      logger.info(`   • Configure: hestia config set ai.platform <opencode|openclaude>`);
    }
    
    logger.info(`\nNext steps:`);
    logger.info(`  1. hestia ignite           # Start the hearth`);
    logger.info(`  2. hestia status           # Check status`);
    logger.info(`  3. hestia add gateway      # Add OpenClaw gateway`);
    logger.info(`  4. hestia add builder      # Add OpenClaude builder`);
    logger.info(`\nFor help: hestia --help`);
    logger.info(`Documentation: https://hestia.sh/docs`);
  });
