/**
 * WhoDB Service - AI-powered database viewer for Hestia
 *
 * WhoDB is a lightweight (<50MB) database visualization tool that provides:
 * - Web UI for database inspection and querying
 * - AI-powered natural language queries (via Ollama)
 * - Visual schema topology and relationship diagrams
 * - Support for PostgreSQL, MySQL, Redis, and more
 *
 * This service manages the WhoDB Docker container lifecycle and configuration,
 * automatically connecting to Hestia's Synap Backend PostgreSQL database and Redis.
 *
 * When to use WhoDB:
 * - Debugging database issues without writing SQL
 * - Exploring unfamiliar database schemas
 * - Visualizing entity relationships in Synap
 * - Quick ad-hoc queries during development
 * - Learning database concepts with visual aids
 *
 * @module whodb-service
 */
import * as fs from "fs/promises";
import * as path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import { logger } from "./logger.js";
import { loadConfig, saveConfig } from "./config.js";
const execAsync = promisify(exec);
// WhoDB default configuration
const WHODB_DEFAULTS = {
    port: 8081,
    aiEnabled: false,
    ollamaModel: "llama3.2",
    logLevel: "info",
};
// Docker container name
const CONTAINER_NAME = "hestia-whodb";
/**
 * WhoDB Service class
 * Manages installation, configuration, and lifecycle of WhoDB container
 */
export class WhoDBService {
    config;
    configPath;
    hestiaHome;
    /**
     * Create a new WhoDBService instance
     * @param hestiaHome - Path to Hestia installation directory (default: /opt/hestia)
     */
    constructor(hestiaHome = "/opt/hestia") {
        this.hestiaHome = hestiaHome;
        this.configPath = path.join(hestiaHome, "config", "config.yaml");
    }
    /**
     * Initialize the service by loading configuration
     */
    async initialize() {
        const { config } = await loadConfig(this.configPath);
        this.config = config;
    }
    /**
     * Install WhoDB by pulling the Docker image
     * This downloads the clidey/whodb image but doesn't start the container
     */
    async install() {
        logger.info("Installing WhoDB (pulling Docker image)...");
        try {
            // Pull the WhoDB image
            const { stdout, stderr } = await execAsync("docker pull clidey/whodb:latest");
            if (stderr && !stderr.includes("Status: Image is up to date")) {
                logger.warn(`Docker pull warning: ${stderr}`);
            }
            logger.success("WhoDB image pulled successfully");
            logger.info(`Image details: ${stdout.split("\n").pop() || "pulled"}`);
            return;
        }
        catch (error) {
            throw new Error(`Failed to pull WhoDB image: ${error instanceof Error ? error.message : "Unknown error"}`);
        }
    }
    /**
     * Configure WhoDB with database connections
     * Creates the docker-compose override file and environment configuration
     */
    async configure() {
        logger.info("Configuring WhoDB...");
        // Ensure config directory exists
        const configDir = path.join(this.hestiaHome, "config");
        await fs.mkdir(configDir, { recursive: true });
        // Create data directories for WhoDB
        const dataDir = path.join(this.hestiaHome, "data", "whodb");
        await fs.mkdir(path.join(dataDir, "queries"), { recursive: true });
        await fs.mkdir(path.join(dataDir, "settings"), { recursive: true });
        // Load current WhoDB config or use defaults
        const dbViewerConfig = this.getWhoDBConfig();
        const port = dbViewerConfig.port || WHODB_DEFAULTS.port;
        // Create environment file for WhoDB
        const envContent = this.generateEnvFile(dbViewerConfig);
        const envPath = path.join(configDir, "whodb.env");
        await fs.writeFile(envPath, envContent, "utf-8");
        // Copy or create docker-compose override file
        const templatePath = path.join(this.hestiaHome, "packages", "install", "src", "templates", "whodb-docker-compose.yml");
        const composePath = path.join(configDir, "docker-compose.whodb.yml");
        try {
            // Try to copy from template
            const template = await fs.readFile(templatePath, "utf-8");
            await fs.writeFile(composePath, template, "utf-8");
        }
        catch {
            // If template doesn't exist, create a basic one
            const basicCompose = this.generateBasicCompose(dbViewerConfig);
            await fs.writeFile(composePath, basicCompose, "utf-8");
        }
        logger.success("WhoDB configured successfully");
        logger.info(`  Port: ${port}`);
        logger.info(`  AI Enabled: ${dbViewerConfig.aiEnabled ? "Yes" : "No"}`);
        logger.info(`  Databases: ${dbViewerConfig.databases.join(", ") || "PostgreSQL, Redis"}`);
    }
    /**
     * Start the WhoDB Docker container
     */
    async start() {
        logger.info("Starting WhoDB...");
        const composePath = path.join(this.hestiaHome, "config", "docker-compose.whodb.yml");
        const envPath = path.join(this.hestiaHome, "config", "whodb.env");
        try {
            // Check if already running
            const status = await this.getStatus();
            if (status === "running") {
                logger.info("WhoDB is already running");
                return;
            }
            // Start with docker compose
            const { stderr } = await execAsync(`docker compose -f ${composePath} --env-file ${envPath} up -d`, { cwd: this.hestiaHome });
            if (stderr && !stderr.includes("Container")) {
                logger.warn(`Docker compose warning: ${stderr}`);
            }
            // Wait for health check
            await this.waitForHealthy();
            logger.success("WhoDB started successfully");
        }
        catch (error) {
            throw new Error(`Failed to start WhoDB: ${error instanceof Error ? error.message : "Unknown error"}`);
        }
    }
    /**
     * Stop the WhoDB Docker container
     */
    async stop() {
        logger.info("Stopping WhoDB...");
        const composePath = path.join(this.hestiaHome, "config", "docker-compose.whodb.yml");
        try {
            await execAsync(`docker compose -f ${composePath} down`, { cwd: this.hestiaHome });
            logger.success("WhoDB stopped");
        }
        catch (error) {
            throw new Error(`Failed to stop WhoDB: ${error instanceof Error ? error.message : "Unknown error"}`);
        }
    }
    /**
     * Get the current status of WhoDB
     * @returns "running" | "stopped" | "error"
     */
    async getStatus() {
        try {
            const { stdout } = await execAsync(`docker ps --filter "name=${CONTAINER_NAME}" --format "{{.State}}"`);
            const state = stdout.trim();
            if (state === "running") {
                // Also check health
                const health = await this.checkHealth();
                return health ? "running" : "error";
            }
            return "stopped";
        }
        catch {
            return "stopped";
        }
    }
    /**
     * Get the URL to access WhoDB
     */
    getUrl() {
        const dbViewerConfig = this.getWhoDBConfig();
        const port = dbViewerConfig.port || WHODB_DEFAULTS.port;
        return `http://localhost:${port}`;
    }
    /**
     * Open WhoDB in the default browser
     */
    async open() {
        const url = this.getUrl();
        logger.info(`Opening WhoDB at ${url}...`);
        try {
            // Try to use the 'open' command on macOS
            await execAsync(`open "${url}"`);
        }
        catch {
            try {
                // Try xdg-open on Linux
                await execAsync(`xdg-open "${url}"`);
            }
            catch {
                try {
                    // Try start on Windows
                    await execAsync(`start "${url}"`);
                }
                catch {
                    logger.info(`Please open ${url} manually in your browser`);
                }
            }
        }
    }
    /**
     * Configure connection to Synap Backend PostgreSQL database
     * Automatically reads connection details from Hestia's configuration
     */
    async connectToSynap() {
        logger.info("Configuring WhoDB connection to Synap database...");
        // Read Synap database configuration from environment
        const envPath = path.join(this.hestiaHome, "config", ".env");
        let synapConfig = {};
        try {
            const envContent = await fs.readFile(envPath, "utf-8");
            synapConfig = this.parseEnvFile(envContent);
        }
        catch {
            logger.warn("Could not read Synap environment configuration, using defaults");
        }
        // Update WhoDB environment with Synap connection details
        const whodbEnvPath = path.join(this.hestiaHome, "config", "whodb.env");
        const whodbEnv = {
            SYNAP_DB_HOST: synapConfig.DATABASE_HOST || "postgres",
            SYNAP_DB_PORT: synapConfig.DATABASE_PORT || "5432",
            SYNAP_DB_USER: synapConfig.DATABASE_USER || "synap",
            SYNAP_DB_PASSWORD: synapConfig.DATABASE_PASSWORD || "",
            SYNAP_DB_NAME: synapConfig.DATABASE_NAME || "synap",
            SYNAP_DB_SSL_MODE: synapConfig.DATABASE_SSL || "disable",
            REDIS_HOST: synapConfig.REDIS_HOST || "redis",
            REDIS_PORT: synapConfig.REDIS_PORT || "6379",
            REDIS_PASSWORD: synapConfig.REDIS_PASSWORD || "",
            REDIS_DB: synapConfig.REDIS_DB || "0",
            HESTIA_HOME: this.hestiaHome,
        };
        // Merge with existing WhoDB env
        let existingEnv = {};
        try {
            const existingContent = await fs.readFile(whodbEnvPath, "utf-8");
            existingEnv = this.parseEnvFile(existingContent);
        }
        catch {
            // File doesn't exist yet
        }
        const mergedEnv = { ...existingEnv, ...whodbEnv };
        const envContent = this.generateEnvFileContent(mergedEnv);
        await fs.writeFile(whodbEnvPath, envContent, "utf-8");
        logger.success("Synap database connection configured");
        // Add to databases list
        await this.addDatabase("synap-postgres");
        await this.addDatabase("synap-redis");
    }
    /**
     * Enable AI integration with Ollama for natural language queries
     * When enabled, users can ask questions in plain English instead of SQL
     */
    async enableAI(model) {
        logger.info("Enabling WhoDB AI integration...");
        // Update configuration
        await this.updateConfig({
            aiEnabled: true,
        });
        // Update environment file
        const envPath = path.join(this.hestiaHome, "config", "whodb.env");
        let env = {};
        try {
            const content = await fs.readFile(envPath, "utf-8");
            env = this.parseEnvFile(content);
        }
        catch {
            // File doesn't exist
        }
        env.WHODB_AI_ENABLED = "true";
        env.WHODB_OLLAMA_MODEL = model || env.WHODB_OLLAMA_MODEL || WHODB_DEFAULTS.ollamaModel;
        env.OLLAMA_HOST = env.OLLAMA_HOST || "http://ollama:11434";
        const envContent = this.generateEnvFileContent(env);
        await fs.writeFile(envPath, envContent, "utf-8");
        logger.success("AI integration enabled");
        logger.info(`  Model: ${env.WHODB_OLLAMA_MODEL}`);
        logger.info("  Users can now ask questions in natural language");
        // Restart if running to apply changes
        const status = await this.getStatus();
        if (status === "running") {
            logger.info("Restarting WhoDB to apply AI configuration...");
            await this.stop();
            await this.start();
        }
    }
    /**
     * Disable AI integration
     */
    async disableAI() {
        logger.info("Disabling WhoDB AI integration...");
        // Update configuration
        await this.updateConfig({
            aiEnabled: false,
        });
        // Update environment file
        const envPath = path.join(this.hestiaHome, "config", "whodb.env");
        let env = {};
        try {
            const content = await fs.readFile(envPath, "utf-8");
            env = this.parseEnvFile(content);
        }
        catch {
            // File doesn't exist
        }
        env.WHODB_AI_ENABLED = "false";
        const envContent = this.generateEnvFileContent(env);
        await fs.writeFile(envPath, envContent, "utf-8");
        logger.success("AI integration disabled");
        // Restart if running
        const status = await this.getStatus();
        if (status === "running") {
            await this.stop();
            await this.start();
        }
    }
    /**
     * Get the logs from the WhoDB container
     */
    async getLogs(tail = 100) {
        try {
            const { stdout } = await execAsync(`docker logs --tail ${tail} ${CONTAINER_NAME}`);
            return stdout;
        }
        catch (error) {
            throw new Error(`Failed to get logs: ${error instanceof Error ? error.message : "Unknown error"}`);
        }
    }
    /**
     * Connect to a specific database by name
     * Adds the database to the list of configured databases
     */
    async connectToDatabase(databaseName) {
        logger.info(`Connecting WhoDB to database: ${databaseName}...`);
        // Add to databases list
        await this.addDatabase(databaseName);
        logger.success(`Database ${databaseName} added to WhoDB configuration`);
        logger.info("Note: WhoDB auto-detects available databases on startup");
    }
    /**
     * Enable WhoDB in the Hestia configuration
     */
    async enable() {
        await this.updateConfig({
            enabled: true,
            provider: "whodb",
        });
        logger.success("WhoDB enabled in Hestia configuration");
    }
    /**
     * Disable WhoDB in the Hestia configuration
     */
    async disable() {
        // Stop if running
        const status = await this.getStatus();
        if (status === "running") {
            await this.stop();
        }
        await this.updateConfig({
            enabled: false,
            provider: "none",
        });
        logger.success("WhoDB disabled");
    }
    // ============ PRIVATE METHODS ============
    /**
     * Get WhoDB configuration from Hestia config
     */
    getWhoDBConfig() {
        const dbViewer = this.config.dbViewer;
        return {
            enabled: dbViewer?.enabled ?? false,
            provider: dbViewer?.provider || "none",
            port: dbViewer?.port || WHODB_DEFAULTS.port,
            aiEnabled: dbViewer?.aiEnabled ?? WHODB_DEFAULTS.aiEnabled,
            databases: dbViewer?.databases || ["synap-postgres", "synap-redis"],
        };
    }
    /**
     * Update WhoDB configuration in Hestia config
     */
    async updateConfig(updates) {
        const current = this.getWhoDBConfig();
        const merged = { ...current, ...updates };
        const newConfig = {
            ...this.config,
            dbViewer: merged,
        };
        await saveConfig(newConfig, this.configPath);
        this.config = newConfig;
    }
    /**
     * Add a database to the configured databases list
     */
    async addDatabase(databaseName) {
        const current = this.getWhoDBConfig();
        if (!current.databases.includes(databaseName)) {
            current.databases.push(databaseName);
            await this.updateConfig({ databases: current.databases });
        }
    }
    /**
     * Generate environment file content for WhoDB
     */
    generateEnvFile(config) {
        const env = {
            WHODB_PORT: String(config.port || WHODB_DEFAULTS.port),
            WHODB_AI_ENABLED: String(config.aiEnabled ?? WHODB_DEFAULTS.aiEnabled),
            WHODB_OLLAMA_MODEL: WHODB_DEFAULTS.ollamaModel,
            WHODB_LOG_LEVEL: WHODB_DEFAULTS.logLevel,
            WHODB_SESSION_SECRET: this.generateSessionSecret(),
            HESTIA_HOME: this.hestiaHome,
        };
        return this.generateEnvFileContent(env);
    }
    /**
     * Generate environment file content from key-value pairs
     */
    generateEnvFileContent(env) {
        const lines = [
            "# WhoDB Environment Configuration",
            "# Auto-generated by Hestia CLI",
            "",
        ];
        for (const [key, value] of Object.entries(env)) {
            lines.push(`${key}=${value}`);
        }
        return lines.join("\n") + "\n";
    }
    /**
     * Generate a random session secret
     */
    generateSessionSecret() {
        const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
        let result = "hestia-whodb-";
        for (let i = 0; i < 32; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }
    /**
     * Generate a basic docker-compose file if template is not available
     */
    generateBasicCompose(config) {
        return `services:
  whodb:
    image: clidey/whodb:latest
    container_name: ${CONTAINER_NAME}
    restart: unless-stopped
    ports:
      - "${config.port || WHODB_DEFAULTS.port}:8081"
    environment:
      PORT: "8081"
      POSTGRES_HOST: \${SYNAP_DB_HOST:-postgres}
      POSTGRES_PORT: \${SYNAP_DB_PORT:-5432}
      POSTGRES_USER: \${SYNAP_DB_USER:-synap}
      POSTGRES_PASSWORD: \${SYNAP_DB_PASSWORD:-}
      POSTGRES_DB: \${SYNAP_DB_NAME:-synap}
      REDIS_HOST: \${REDIS_HOST:-redis}
      REDIS_PORT: \${REDIS_PORT:-6379}
      OLLAMA_ENABLED: \${WHODB_AI_ENABLED:-false}
      OLLAMA_HOST: \${OLLAMA_HOST:-http://ollama:11434}
    volumes:
      - \${HESTIA_HOME:-/opt/hestia}/data/whodb/queries:/app/queries
    networks:
      - hestia-network

networks:
  hestia-network:
    external: true
    name: hestia-network
`;
    }
    /**
     * Parse environment file content into key-value pairs
     */
    parseEnvFile(content) {
        const result = {};
        for (const line of content.split("\n")) {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith("#")) {
                const equalIndex = trimmed.indexOf("=");
                if (equalIndex > 0) {
                    const key = trimmed.substring(0, equalIndex);
                    const value = trimmed.substring(equalIndex + 1);
                    result[key] = value;
                }
            }
        }
        return result;
    }
    /**
     * Check if WhoDB container is healthy
     */
    async checkHealth() {
        try {
            const { stdout } = await execAsync(`docker inspect --format='{{.State.Health.Status}}' ${CONTAINER_NAME}`);
            return stdout.trim() === "healthy";
        }
        catch {
            return false;
        }
    }
    /**
     * Wait for WhoDB to become healthy
     */
    async waitForHealthy(timeout = 30000) {
        const startTime = Date.now();
        while (Date.now() - startTime < timeout) {
            if (await this.checkHealth()) {
                return;
            }
            await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        throw new Error("WhoDB failed to become healthy within timeout");
    }
}
// Export singleton instance for convenience
export const whoDBService = new WhoDBService();
//# sourceMappingURL=whodb-service.js.map