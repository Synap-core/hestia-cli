/**
 * Hestia CLI - Init Command
 *
 * Initialize a new digital hearth.
 */
import { Command } from "commander";
import inquirer from "inquirer";
import { createInitialConfig, configExists, updateConfig } from "../lib/config.js";
import { checkPodHealth } from "../lib/api-client.js";
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
    .option("--skip-registration", "Skip registering with backend")
    .option("--quick", "Quick setup with defaults")
    .action(async (options, command) => {
    const { verbose, dryRun } = command.parent?.opts() || {};
    const logger = {
        debug: verbose ? console.log : () => { },
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
        const config = await createInitialConfig({
            hearthName: options.name || "My Digital Hearth",
            role: options.role,
            domain: options.domain,
            intelligence: {
                provider: options.intelligence,
                endpoint: options.endpoint,
                model: options.model,
            },
        });
        logger.info("\n✓ Hestia initialized successfully!");
        logger.info(`\nHearth ID: ${config.hearth.id}`);
        logger.info(`Name: ${config.hearth.name}`);
        logger.info(`Role: ${config.hearth.role}`);
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
            default: (answers) => {
                if (answers.intelligenceProvider === "ollama") {
                    return "http://localhost:11434";
                }
                return "";
            },
            when: (answers) => answers.intelligenceProvider !== "openrouter" &&
                answers.intelligenceProvider !== "anthropic" &&
                answers.intelligenceProvider !== "openai" &&
                !options.endpoint,
        },
        {
            type: "input",
            name: "model",
            message: "Default model:",
            default: (answers) => {
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
    ]);
    const config = {
        name: options.name || answers.name,
        role: options.role || answers.role,
        domain: options.domain || answers.domain,
        intelligenceProvider: options.intelligence || answers.intelligenceProvider,
        endpointUrl: options.endpoint || answers.endpointUrl,
        model: options.model || answers.model,
        podUrl: options.podUrl || answers.podUrl,
        optionalServices: answers.optionalServices || [],
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
    }
    else {
        logger.info(`✓ Backend available (version: ${health.version})\n`);
    }
    // Create configuration
    let hestiaConfig = await createInitialConfig({
        hearthName: config.name,
        role: config.role,
        domain: config.domain,
        intelligence: {
            provider: config.intelligenceProvider,
            endpoint: config.endpointUrl,
            model: config.model,
        },
    });
    // Setup optional services if selected
    if (config.optionalServices.length > 0) {
        logger.info("\n🔧 Setting up optional services...\n");
        const optionalServicesConfig = {};
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
                logger.success(`✓ ${serviceName} installed and enabled`);
            }
            catch (error) {
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
    // Register with backend if available
    if (health.healthy && !options.skipRegistration) {
        logger.info("Registering hearth with backend...");
        try {
            // For now, we'll need a provisioning token or API key
            // In the real implementation, this would handle auth
            logger.info("\nℹ️  To complete registration, you'll need a PROVISIONING_TOKEN.");
            logger.info("   Run: hestia connect --token <token>\n");
        }
        catch (error) {
            logger.warn("Could not register with backend:");
            logger.warn(error instanceof Error ? error.message : String(error));
        }
    }
    // Success!
    logger.info("\n✅ Hestia initialized successfully!\n");
    logger.info(`Hearth ID: ${hestiaConfig.hearth.id}`);
    logger.info(`Name: ${hestiaConfig.hearth.name}`);
    logger.info(`Role: ${hestiaConfig.hearth.role}`);
    logger.info(`\nNext steps:`);
    logger.info(`  1. hestia ignite           # Start the hearth`);
    logger.info(`  2. hestia status             # Check status`);
    logger.info(`  3. hestia add gateway        # Add OpenClaw gateway`);
    logger.info(`  4. hestia add builder        # Add OpenClaude builder`);
    logger.info(`\nFor help: hestia --help`);
    logger.info(`Documentation: https://hestia.sh/docs`);
});
//# sourceMappingURL=init.js.map