/**
 * AI Chat Service - Manage AI Chat UI interfaces for Hestia
 *
 * Provides management for optional AI chat interfaces:
 * - LobeChat: Modern UI with plugin ecosystem
 * - Open WebUI: Native Ollama integration
 * - LibreChat: ChatGPT-like interface with multi-model support
 *
 * All services are optional and connect to Hestia's AI backend (Ollama/OpenClaude).
 */
import * as fs from "fs/promises";
import * as path from "path";
import { execa } from "execa";
import { z } from "zod";
import { logger } from "./logger.js";
import { loadConfig, updateConfig, getConfigPaths } from "./config.js";
// Provider configuration schema
const providerConfigSchema = z.object({
    name: z.enum(["lobechat", "openwebui", "librechat"]),
    enabled: z.boolean(),
    port: z.number(),
    url: z.string().optional(),
    config: z.record(z.unknown()).optional(),
});
const aiChatConfigSchema = z.object({
    providers: z.array(providerConfigSchema),
    defaultProvider: z.enum(["lobechat", "openwebui", "librechat"]).optional(),
});
// Provider definitions with metadata
const PROVIDER_DEFINITIONS = {
    lobechat: {
        name: "LobeChat",
        description: "Modern, beautiful AI chat interface with plugin ecosystem",
        defaultPort: 3010,
        image: "lobehub/lobe-chat:latest",
        features: [
            "Modern, polished UI design",
            "Extensive plugin marketplace",
            "Built-in agent/agent framework",
            "Voice input support",
            "Mobile-responsive",
            "Multiple AI provider support",
        ],
        bestFor: "Users who want a modern, feature-rich experience with plugins",
        dockerProfile: "lobechat",
    },
    openwebui: {
        name: "Open WebUI",
        description: "Native Ollama integration with RAG support",
        defaultPort: 3011,
        image: "ghcr.io/open-webui/open-webui:latest",
        features: [
            "Native Ollama integration",
            "Built-in RAG for documents",
            "Document upload and Q&A",
            "Voice input and output",
            "Pipelines for custom processing",
            "User management and permissions",
            "Web search integration",
        ],
        bestFor: "Users who want direct Ollama integration with native feel",
        dockerProfile: "openwebui",
    },
    librechat: {
        name: "LibreChat",
        description: "ChatGPT clone with multi-model support",
        defaultPort: 3012,
        image: "ghcr.io/danny-avila/librechat:latest",
        features: [
            "ChatGPT-like interface",
            "Conversation branching",
            "Multiple AI endpoints simultaneously",
            "Preset management",
            "Plugins and tools support",
            "Message editing and regeneration",
            "Multi-user support",
        ],
        bestFor: "Users who want a ChatGPT-like experience with model choice",
        dockerProfile: "librechat",
    },
};
export class AIChatService {
    configPath;
    dockerComposePath;
    constructor(configPath) {
        this.configPath = configPath || getConfigPaths().userConfig;
        this.dockerComposePath = process.env.HESTIA_TARGET || "/opt/hestia";
    }
    /**
     * Install a specific AI chat UI provider
     * Downloads the Docker image and configures the service
     */
    async install(provider) {
        const definition = PROVIDER_DEFINITIONS[provider];
        logger.info(`Installing ${definition.name}...`);
        logger.info(`  Description: ${definition.description}`);
        logger.info(`  Best for: ${definition.bestFor}`);
        logger.info(`  Port: ${definition.defaultPort}`);
        // Pull the Docker image
        try {
            await execa("docker", ["pull", definition.image], {
                stdio: "inherit",
            });
            logger.success(`Downloaded ${definition.name} image`);
        }
        catch (error) {
            logger.error(`Failed to download ${definition.name} image: ${error}`);
            throw new Error(`Installation failed: ${error}`);
        }
        // Add to Hestia configuration
        const { config } = await loadConfig(this.configPath);
        if (!config.aiChat) {
            config.aiChat = { providers: [] };
        }
        // Check if already installed
        const existingIndex = config.aiChat.providers.findIndex((p) => p.name === provider);
        const providerConfig = {
            name: provider,
            enabled: false, // Not enabled yet, needs to be started
            port: definition.defaultPort,
            url: `http://localhost:${definition.defaultPort}`,
            config: {
                installedAt: new Date().toISOString(),
                version: "latest",
            },
        };
        if (existingIndex >= 0) {
            config.aiChat.providers[existingIndex] = providerConfig;
        }
        else {
            config.aiChat.providers.push(providerConfig);
        }
        await updateConfig({ aiChat: config.aiChat }, this.configPath);
        logger.success(`${definition.name} installed successfully`);
        logger.info(`\nTo start: hestia ai:chat:start ${provider}`);
        logger.info(`To open: hestia ai:chat:open ${provider}`);
    }
    /**
     * Configure a specific AI chat UI with AI backend settings
     */
    async configure(provider, config) {
        logger.info(`Configuring ${PROVIDER_DEFINITIONS[provider].name}...`);
        const { config: hestiaConfig } = await loadConfig(this.configPath);
        if (!hestiaConfig.aiChat) {
            throw new Error("AI chat not initialized. Run install first.");
        }
        const providerIndex = hestiaConfig.aiChat.providers.findIndex((p) => p.name === provider);
        if (providerIndex < 0) {
            throw new Error(`${provider} is not installed. Run install first.`);
        }
        // Merge new config with existing
        hestiaConfig.aiChat.providers[providerIndex].config = {
            ...hestiaConfig.aiChat.providers[providerIndex].config,
            ...config,
            updatedAt: new Date().toISOString(),
        };
        await updateConfig({ aiChat: hestiaConfig.aiChat }, this.configPath);
        logger.success(`${PROVIDER_DEFINITIONS[provider].name} configured`);
    }
    /**
     * Start a specific AI chat UI service
     */
    async start(provider) {
        const definition = PROVIDER_DEFINITIONS[provider];
        logger.info(`Starting ${definition.name}...`);
        const composeFile = path.join(this.dockerComposePath, "docker-compose.yml");
        // Check if AI chat services are in the docker-compose
        const hasAIChat = await this.checkComposeIncludesAIChat(composeFile);
        if (!hasAIChat) {
            logger.warn("AI chat services not found in docker-compose.yml");
            logger.info("Adding AI chat services to docker-compose...");
            await this.appendAIChatToCompose(composeFile);
        }
        // Start the service with the appropriate profile
        try {
            await execa("docker", ["compose", "--profile", definition.dockerProfile, "up", "-d", provider], {
                cwd: this.dockerComposePath,
                stdio: "inherit",
            });
            logger.success(`${definition.name} started`);
            logger.info(`  URL: http://localhost:${definition.defaultPort}`);
        }
        catch (error) {
            logger.error(`Failed to start ${definition.name}: ${error}`);
            throw new Error(`Start failed: ${error}`);
        }
        // Update config to mark as enabled
        const { config } = await loadConfig(this.configPath);
        if (config.aiChat) {
            const providerIndex = config.aiChat.providers.findIndex((p) => p.name === provider);
            if (providerIndex >= 0) {
                config.aiChat.providers[providerIndex].enabled = true;
                config.aiChat.providers[providerIndex].url = `http://localhost:${definition.defaultPort}`;
                await updateConfig({ aiChat: config.aiChat }, this.configPath);
            }
        }
    }
    /**
     * Stop a specific AI chat UI service
     */
    async stop(provider) {
        const definition = PROVIDER_DEFINITIONS[provider];
        logger.info(`Stopping ${definition.name}...`);
        try {
            await execa("docker", ["compose", "stop", provider], {
                cwd: this.dockerComposePath,
                stdio: "inherit",
            });
            logger.success(`${definition.name} stopped`);
        }
        catch (error) {
            logger.error(`Failed to stop ${definition.name}: ${error}`);
            throw new Error(`Stop failed: ${error}`);
        }
        // Update config to mark as disabled
        const { config } = await loadConfig(this.configPath);
        if (config.aiChat) {
            const providerIndex = config.aiChat.providers.findIndex((p) => p.name === provider);
            if (providerIndex >= 0) {
                config.aiChat.providers[providerIndex].enabled = false;
                await updateConfig({ aiChat: config.aiChat }, this.configPath);
            }
        }
    }
    /**
     * Get status of a specific AI chat UI service
     */
    async getStatus(provider) {
        const definition = PROVIDER_DEFINITIONS[provider];
        try {
            // Check if container is running
            const { stdout } = await execa("docker", ["ps", "--format", "{{.Names}}", "--filter", `name=hestia-${provider}`], { cwd: this.dockerComposePath });
            const isRunning = stdout.includes(`hestia-${provider}`);
            // Check if accessible
            let isAccessible = false;
            let health = "unhealthy";
            if (isRunning) {
                try {
                    const response = await fetch(`http://localhost:${definition.defaultPort}/health`, {
                        method: "GET",
                    });
                    isAccessible = response.ok;
                    health = response.ok ? "healthy" : "degraded";
                }
                catch {
                    // Health endpoint might not exist, try root
                    try {
                        const response = await fetch(`http://localhost:${definition.defaultPort}`, {
                            method: "GET",
                        });
                        isAccessible = response.ok;
                        health = response.ok ? "healthy" : "degraded";
                    }
                    catch {
                        health = "unhealthy";
                    }
                }
            }
            // Get installed status from config
            const { config } = await loadConfig(this.configPath);
            const installed = config.aiChat?.providers.some((p) => p.name === provider) ?? false;
            return {
                provider,
                name: definition.name,
                installed,
                running: isRunning,
                accessible: isAccessible,
                port: definition.defaultPort,
                url: `http://localhost:${definition.defaultPort}`,
                health,
            };
        }
        catch (error) {
            logger.error(`Failed to get status for ${provider}: ${error}`);
            return {
                provider,
                name: definition.name,
                installed: false,
                running: false,
                accessible: false,
                port: definition.defaultPort,
                url: `http://localhost:${definition.defaultPort}`,
                health: "unhealthy",
                error: String(error),
            };
        }
    }
    /**
     * Get access URL for a specific AI chat UI
     */
    async getUrl(provider) {
        const definition = PROVIDER_DEFINITIONS[provider];
        return `http://localhost:${definition.defaultPort}`;
    }
    /**
     * List all installed AI chat UIs with their status
     */
    async listInstalled() {
        const { config } = await loadConfig(this.configPath);
        if (!config.aiChat || config.aiChat.providers.length === 0) {
            return [];
        }
        const statuses = [];
        for (const provider of config.aiChat.providers) {
            const status = await this.getStatus(provider.name);
            statuses.push(status);
        }
        return statuses;
    }
    /**
     * List all available AI chat UI providers (not just installed)
     */
    listAvailable() {
        return Object.entries(PROVIDER_DEFINITIONS).map(([key, def]) => ({
            name: key,
            displayName: def.name,
            description: def.description,
            features: def.features,
            bestFor: def.bestFor,
            port: def.defaultPort,
        }));
    }
    /**
     * Enable all AI chat UIs simultaneously
     */
    async enableAll() {
        logger.info("Enabling all AI chat UIs...");
        const providers = ["lobechat", "openwebui", "librechat"];
        // Install all if not already installed
        for (const provider of providers) {
            try {
                const status = await this.getStatus(provider);
                if (!status.installed) {
                    await this.install(provider);
                }
            }
            catch (error) {
                logger.warn(`Could not install ${provider}: ${error}`);
            }
        }
        // Start all with ai-chat-all profile
        try {
            await execa("docker", ["compose", "--profile", "ai-chat-all", "up", "-d"], {
                cwd: this.dockerComposePath,
                stdio: "inherit",
            });
            logger.success("All AI chat UIs started");
            // Update config
            const { config } = await loadConfig(this.configPath);
            if (!config.aiChat) {
                config.aiChat = { providers: [] };
            }
            for (const provider of providers) {
                const existingIndex = config.aiChat.providers.findIndex((p) => p.name === provider);
                const providerConfig = {
                    name: provider,
                    enabled: true,
                    port: PROVIDER_DEFINITIONS[provider].defaultPort,
                    url: `http://localhost:${PROVIDER_DEFINITIONS[provider].defaultPort}`,
                };
                if (existingIndex >= 0) {
                    config.aiChat.providers[existingIndex] = providerConfig;
                }
                else {
                    config.aiChat.providers.push(providerConfig);
                }
            }
            await updateConfig({ aiChat: config.aiChat }, this.configPath);
        }
        catch (error) {
            logger.error(`Failed to enable all AI chat UIs: ${error}`);
            throw new Error(`Enable all failed: ${error}`);
        }
    }
    /**
     * Remove a specific AI chat UI
     */
    async remove(provider) {
        const definition = PROVIDER_DEFINITIONS[provider];
        logger.info(`Removing ${definition.name}...`);
        // Stop if running
        try {
            await this.stop(provider);
        }
        catch {
            // Ignore stop errors
        }
        // Remove container
        try {
            await execa("docker", ["rm", "-f", `hestia-${provider}`], { stdio: "pipe" });
        }
        catch {
            // Container might not exist
        }
        // Remove from config
        const { config } = await loadConfig(this.configPath);
        if (config.aiChat) {
            config.aiChat.providers = config.aiChat.providers.filter((p) => p.name !== provider);
            await updateConfig({ aiChat: config.aiChat }, this.configPath);
        }
        logger.success(`${definition.name} removed`);
    }
    /**
     * Show logs for a specific AI chat UI
     */
    async logs(provider, follow = false) {
        const definition = PROVIDER_DEFINITIONS[provider];
        const args = ["compose", "logs", provider];
        if (follow) {
            args.push("-f");
        }
        try {
            await execa("docker", args, {
                cwd: this.dockerComposePath,
                stdio: "inherit",
            });
        }
        catch (error) {
            logger.error(`Failed to get logs for ${definition.name}: ${error}`);
            throw new Error(`Logs failed: ${error}`);
        }
    }
    /**
     * Connect AI chat UIs to a specific AI backend (Ollama/OpenClaude)
     */
    async connectToAI(backend) {
        logger.info(`Connecting AI chat UIs to ${backend}...`);
        const { config } = await loadConfig(this.configPath);
        const aiConfig = config.intelligence;
        if (!aiConfig) {
            throw new Error("AI backend not configured. Run hestia init first.");
        }
        // Update environment configuration
        const envVars = {
            INTELLIGENCE_PROVIDER: backend,
            INTELLIGENCE_ENDPOINT: aiConfig.endpoint || "http://localhost:11434",
            INTELLIGENCE_MODEL: aiConfig.model || "llama3.2",
        };
        if (aiConfig.apiKey) {
            envVars.INTELLIGENCE_API_KEY = aiConfig.apiKey;
        }
        // Write to .env file
        const envPath = path.join(this.dockerComposePath, "config", ".env");
        await this.appendEnvVars(envPath, envVars);
        // Restart services if running
        const providers = ["lobechat", "openwebui", "librechat"];
        for (const provider of providers) {
            const status = await this.getStatus(provider);
            if (status.running) {
                logger.info(`Restarting ${provider} with new backend configuration...`);
                await this.stop(provider);
                await this.start(provider);
            }
        }
        logger.success(`AI chat UIs configured to use ${backend}`);
    }
    /**
     * Open AI chat UI in browser
     */
    async open(provider) {
        const url = await this.getUrl(provider);
        logger.info(`Opening ${PROVIDER_DEFINITIONS[provider].name} at ${url}...`);
        try {
            // Try different commands to open browser
            const commands = [
                ["open", url], // macOS
                ["xdg-open", url], // Linux
                ["start", url], // Windows
            ];
            for (const cmd of commands) {
                try {
                    await execa(cmd[0], [cmd[1]], { stdio: "ignore" });
                    return;
                }
                catch {
                    // Try next command
                }
            }
            logger.info(`Please open your browser to: ${url}`);
        }
        catch (error) {
            logger.info(`Please open your browser to: ${url}`);
        }
    }
    // ═══════════════════════════════════════════════════════════════════════════
    // PRIVATE HELPERS
    // ═══════════════════════════════════════════════════════════════════════════
    /**
     * Check if docker-compose.yml includes AI chat services
     */
    async checkComposeIncludesAIChat(composePath) {
        try {
            const content = await fs.readFile(composePath, "utf-8");
            return content.includes("hestia-lobechat") || content.includes("lobechat:");
        }
        catch {
            return false;
        }
    }
    /**
     * Append AI chat services to docker-compose.yml
     */
    async appendAIChatToCompose(composePath) {
        const templatePath = path.join(__dirname, "../../../install/src/templates/ai-chat-docker-compose.yml");
        try {
            const templateContent = await fs.readFile(templatePath, "utf-8");
            // Extract just the services section (skip version header)
            const servicesMatch = templateContent.match(/services:\n([\s\S]*?)(?=\nvolumes:|\n#|$)/);
            if (servicesMatch) {
                const servicesContent = servicesMatch[1];
                // Append to existing docker-compose
                const existingContent = await fs.readFile(composePath, "utf-8");
                const updatedContent = existingContent + "\n" + servicesContent;
                await fs.writeFile(composePath, updatedContent, "utf-8");
                logger.success("AI chat services added to docker-compose.yml");
            }
        }
        catch (error) {
            logger.warn(`Could not append AI chat services: ${error}`);
            logger.info("You may need to manually add AI chat services to docker-compose.yml");
        }
    }
    /**
     * Append environment variables to .env file
     */
    async appendEnvVars(envPath, vars) {
        let content = "";
        try {
            content = await fs.readFile(envPath, "utf-8");
        }
        catch {
            // File doesn't exist, will create
        }
        // Remove existing AI chat vars
        const lines = content.split("\n").filter((line) => {
            return !line.startsWith("INTELLIGENCE_");
        });
        // Add new vars
        lines.push("\n# AI Backend Configuration");
        for (const [key, value] of Object.entries(vars)) {
            lines.push(`${key}=${value}`);
        }
        await fs.writeFile(envPath, lines.join("\n"), "utf-8");
    }
}
// Export singleton instance
export const aiChatService = new AIChatService();
//# sourceMappingURL=ai-chat-service.js.map