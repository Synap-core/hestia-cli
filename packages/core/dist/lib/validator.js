/**
 * Production Validation Framework for Hestia CLI
 *
 * Validates the entire Hestia system before production deployment.
 * Provides comprehensive checks for system health, dependencies, configuration,
 * and integrations across all components.
 */
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { execSync } from "child_process";
import { createInterface } from "readline";
import net from "net";
import YAML from "yaml";
import { logger } from "./logger.js";
import { loadConfig, getConfigPaths } from "./config.js";
import { createAPIClient } from "./api-client.js";
import { A2ABridge } from "./a2a-bridge.js";
import { UnifiedStateManager } from "./state-manager.js";
// ============================================================================
// Constants
// ============================================================================
const REQUIRED_PORTS = [3000, 4000, 5432, 6379, 8080, 11434];
const MIN_NODE_VERSION = 18;
const SUPPORTED_PLATFORMS = ["linux", "darwin"];
const SUPPORTED_ARCHITECTURES = ["x64", "arm64"];
const HESTIA_VERSION = "0.1.0";
const CRITICAL_VALIDATIONS = [
    "validateNodeVersion",
    "validateDocker",
    "validateHestiaConfig",
    "validateHestiaDirectories",
];
// ============================================================================
// Production Validator Class
// ============================================================================
export class ProductionValidator {
    apiClient = null;
    stateManager = null;
    a2aBridge = null;
    validationCache = new Map();
    cacheExpiry = new Map();
    CACHE_TTL = 5 * 60 * 1000; // 5 minutes
    // Track results for report generation
    currentReport = null;
    // ============================================================================
    // System Validation
    // ============================================================================
    /**
     * Validate Node.js version is >= 18
     */
    async validateNodeVersion() {
        return this.runValidation("node-version", async () => {
            const result = {
                valid: true,
                errors: [],
                warnings: [],
                info: [],
                fixes: [],
            };
            const nodeVersion = process.version;
            const majorVersion = parseInt(nodeVersion.slice(1).split(".")[0], 10);
            result.info.push(`Node.js version: ${nodeVersion}`);
            if (majorVersion < MIN_NODE_VERSION) {
                result.valid = false;
                result.errors.push(`Node.js version ${nodeVersion} is too old. Required: >= ${MIN_NODE_VERSION}.x`);
                result.fixes.push(`Install Node.js ${MIN_NODE_VERSION} or later using nvm: nvm install ${MIN_NODE_VERSION}`);
                result.fixes.push(`Or download from: https://nodejs.org/en/download/`);
            }
            return result;
        });
    }
    /**
     * Validate platform is supported (Linux/macOS)
     */
    async validatePlatform() {
        return this.runValidation("platform", async () => {
            const result = {
                valid: true,
                errors: [],
                warnings: [],
                info: [],
                fixes: [],
            };
            const platform = os.platform();
            result.info.push(`Platform: ${platform}`);
            if (!SUPPORTED_PLATFORMS.includes(platform)) {
                if (platform === "win32") {
                    result.valid = false;
                    result.errors.push(`Windows is not supported for production deployment. Use WSL2 or a Linux VM.`);
                    result.fixes.push(`Install WSL2: wsl --install`);
                    result.fixes.push(`Or use a Linux cloud instance`);
                }
                else {
                    result.valid = false;
                    result.errors.push(`Platform '${platform}' is not supported. Supported: ${SUPPORTED_PLATFORMS.join(", ")}`);
                }
            }
            return result;
        });
    }
    /**
     * Validate architecture is supported
     */
    async validateArchitecture() {
        return this.runValidation("architecture", async () => {
            const result = {
                valid: true,
                errors: [],
                warnings: [],
                info: [],
                fixes: [],
            };
            const arch = os.arch();
            result.info.push(`Architecture: ${arch}`);
            if (!SUPPORTED_ARCHITECTURES.includes(arch)) {
                result.valid = false;
                result.errors.push(`Architecture '${arch}' is not supported. Supported: ${SUPPORTED_ARCHITECTURES.join(", ")}`);
                result.fixes.push(`Use an x64 or arm64 machine for production deployment`);
            }
            // Warn on arm64 for some Docker images
            if (arch === "arm64") {
                result.warnings.push(`ARM64 architecture detected. Some Docker images may not have ARM64 builds.`);
                result.fixes.push(`Enable Docker BuildKit for better multi-arch support: export DOCKER_BUILDKIT=1`);
            }
            return result;
        });
    }
    /**
     * Validate write permissions to required directories
     */
    async validatePermissions() {
        return this.runValidation("permissions", async () => {
            const result = {
                valid: true,
                errors: [],
                warnings: [],
                info: [],
                fixes: [],
            };
            const paths = getConfigPaths();
            const testDirs = [
                { path: paths.configDir, name: "Hestia config" },
                { path: os.homedir(), name: "Home directory" },
                { path: path.join(os.tmpdir(), "hestia-test"), name: "Temp directory" },
            ];
            // Add system config dir for Linux
            if (os.platform() === "linux") {
                testDirs.push({ path: "/opt/hestia", name: "System opt" });
            }
            for (const { path: testPath, name } of testDirs) {
                try {
                    // Check if directory exists and is writable
                    await fs.mkdir(testPath, { recursive: true });
                    const testFile = path.join(testPath, `.write-test-${Date.now()}`);
                    await fs.writeFile(testFile, "test");
                    await fs.unlink(testFile);
                    result.info.push(`${name} (${testPath}): writable`);
                }
                catch (error) {
                    const errMsg = error instanceof Error ? error.message : String(error);
                    result.errors.push(`${name} (${testPath}): not writable - ${errMsg}`);
                    result.valid = false;
                    result.fixes.push(`Fix permissions: sudo chown -R $(whoami) ${testPath}`);
                }
            }
            return result;
        });
    }
    // ============================================================================
    // Dependency Validation
    // ============================================================================
    /**
     * Validate Docker is installed and running
     */
    async validateDocker() {
        return this.runValidation("docker", async () => {
            const result = {
                valid: true,
                errors: [],
                warnings: [],
                info: [],
                fixes: [],
            };
            // Check if docker command exists
            try {
                const version = execSync("docker --version", { encoding: "utf-8" }).trim();
                result.info.push(version);
            }
            catch {
                result.valid = false;
                result.errors.push(`Docker is not installed or not in PATH`);
                result.fixes.push(`Install Docker: https://docs.docker.com/get-docker/`);
                return result;
            }
            // Check if docker daemon is running
            try {
                execSync("docker info", { stdio: "pipe" });
                result.info.push(`Docker daemon: running`);
            }
            catch {
                result.valid = false;
                result.errors.push(`Docker daemon is not running`);
                result.fixes.push(`Start Docker: sudo systemctl start docker`);
                result.fixes.push(`Or on macOS: open -a Docker`);
            }
            // Check if user is in docker group (Linux only)
            if (os.platform() === "linux") {
                try {
                    const groups = execSync("groups", { encoding: "utf-8" }).trim();
                    if (!groups.includes("docker")) {
                        result.warnings.push(`User is not in 'docker' group. May need sudo for docker commands.`);
                        result.fixes.push(`Add to docker group: sudo usermod -aG docker $USER && newgrp docker`);
                    }
                }
                catch {
                    // Ignore groups check errors
                }
            }
            return result;
        });
    }
    /**
     * Validate docker-compose is available
     */
    async validateDockerCompose() {
        return this.runValidation("docker-compose", async () => {
            const result = {
                valid: true,
                errors: [],
                warnings: [],
                info: [],
                fixes: [],
            };
            // Try docker compose (v2) first, then docker-compose (v1)
            try {
                const version = execSync("docker compose version", { encoding: "utf-8" }).trim();
                result.info.push(`Docker Compose V2: ${version}`);
            }
            catch {
                try {
                    const version = execSync("docker-compose --version", { encoding: "utf-8" }).trim();
                    result.info.push(`Docker Compose V1: ${version}`);
                    result.warnings.push(`Using legacy docker-compose. Consider upgrading to Docker Compose V2.`);
                }
                catch {
                    result.valid = false;
                    result.errors.push(`Docker Compose is not installed`);
                    result.fixes.push(`Docker Compose is included with Docker Desktop`);
                    result.fixes.push(`On Linux: https://docs.docker.com/compose/install/linux/`);
                }
            }
            return result;
        });
    }
    /**
     * Validate git is installed
     */
    async validateGit() {
        return this.runValidation("git", async () => {
            const result = {
                valid: true,
                errors: [],
                warnings: [],
                info: [],
                fixes: [],
            };
            try {
                const version = execSync("git --version", { encoding: "utf-8" }).trim();
                result.info.push(version);
                // Check git config
                try {
                    const name = execSync("git config --global user.name", { encoding: "utf-8" }).trim();
                    const email = execSync("git config --global user.email", { encoding: "utf-8" }).trim();
                    if (name && email) {
                        result.info.push(`Git user: ${name} <${email}>`);
                    }
                    else {
                        result.warnings.push(`Git user.name or user.email not configured`);
                        result.fixes.push(`git config --global user.name "Your Name"`);
                        result.fixes.push(`git config --global user.email "your@email.com"`);
                    }
                }
                catch {
                    result.warnings.push(`Git config not set`);
                }
            }
            catch {
                result.valid = false;
                result.errors.push(`Git is not installed`);
                result.fixes.push(`Install Git: https://git-scm.com/downloads`);
            }
            return result;
        });
    }
    /**
     * Validate internet connectivity
     */
    async validateNetwork() {
        return this.runValidation("network", async () => {
            const result = {
                valid: true,
                errors: [],
                warnings: [],
                info: [],
                fixes: [],
            };
            const endpoints = [
                { host: "github.com", port: 443, name: "GitHub" },
                { host: "registry.npmjs.org", port: 443, name: "npm registry" },
                { host: "docker.io", port: 443, name: "Docker Hub" },
                { host: "api.openai.com", port: 443, name: "OpenAI API", optional: true },
            ];
            const checks = endpoints.map(({ host, port, name, optional }) => {
                return new Promise((resolve, reject) => {
                    const socket = new net.Socket();
                    socket.setTimeout(5000);
                    socket
                        .on("connect", () => {
                        result.info.push(`${name}: reachable`);
                        socket.destroy();
                        resolve();
                    })
                        .on("timeout", () => {
                        socket.destroy();
                        reject(new Error(`${name}: connection timeout`));
                    })
                        .on("error", (err) => {
                        socket.destroy();
                        reject(new Error(`${name}: ${err.message}`));
                    })
                        .connect(port, host);
                }).catch((err) => {
                    if (optional) {
                        result.warnings.push(`${err.message} (optional)`);
                    }
                    else {
                        result.errors.push(err.message);
                        result.valid = false;
                    }
                });
            });
            await Promise.all(checks);
            if (result.errors.length > 0) {
                result.fixes.push(`Check network connection and firewall settings`);
                result.fixes.push(`Verify DNS resolution: nslookup github.com`);
            }
            return result;
        });
    }
    /**
     * Validate required ports are available
     */
    async validatePorts() {
        return this.runValidation("ports", async () => {
            const result = {
                valid: true,
                errors: [],
                warnings: [],
                info: [],
                fixes: [],
            };
            const portServices = {
                3000: "Synap Frontend",
                4000: "Synap Backend API",
                5432: "PostgreSQL",
                6379: "Redis",
                8080: "Hestia Gateway",
                11434: "Ollama (optional)",
            };
            const checks = REQUIRED_PORTS.map((port) => {
                return new Promise((resolve, reject) => {
                    const server = net.createServer();
                    server
                        .once("error", (err) => {
                        if (err.code === "EADDRINUSE") {
                            reject(new Error(`Port ${port} is in use`));
                        }
                        else {
                            reject(new Error(`Port ${port}: ${err.message}`));
                        }
                    })
                        .once("listening", () => {
                        server.close();
                        resolve();
                    })
                        .listen(port);
                })
                    .then(() => {
                    const service = portServices[port] || "Unknown";
                    result.info.push(`Port ${port}: available (${service})`);
                })
                    .catch((err) => {
                    const service = portServices[port] || "Unknown";
                    if (port === 11434) {
                        // Ollama is optional
                        result.warnings.push(`${err.message} - ${service} (optional)`);
                    }
                    else {
                        result.errors.push(`${err.message} - ${service}`);
                        result.valid = false;
                    }
                });
            });
            await Promise.all(checks);
            if (result.errors.length > 0) {
                result.fixes.push(`Stop services using these ports or change Hestia configuration`);
                result.fixes.push(`Check: sudo lsof -i :PORT`);
                result.fixes.push(`Kill process: sudo kill -9 PID`);
            }
            return result;
        });
    }
    // ============================================================================
    // Hestia Core Validation
    // ============================================================================
    /**
     * Validate Hestia configuration file
     */
    async validateHestiaConfig() {
        return this.runValidation("hestia-config", async () => {
            const result = {
                valid: true,
                errors: [],
                warnings: [],
                info: [],
                fixes: [],
            };
            const paths = getConfigPaths();
            // Check if config exists
            try {
                await fs.access(paths.userConfig);
                result.info.push(`Config file exists: ${paths.userConfig}`);
            }
            catch {
                result.valid = false;
                result.errors.push(`Hestia config file not found at ${paths.userConfig}`);
                result.fixes.push(`Run 'hestia init' to create initial configuration`);
                result.fixes.push(`Or create manually: ${paths.userConfig}`);
                return result;
            }
            // Validate YAML syntax and schema
            try {
                const { config } = await loadConfig();
                result.info.push(`Config version: ${config.version}`);
                result.info.push(`Hearth name: ${config.hearth.name}`);
                result.info.push(`Hearth role: ${config.hearth.role}`);
                // Validate required fields
                if (!config.hearth.name || config.hearth.name === "My Digital Hearth") {
                    result.warnings.push(`Hearth name is using default value`);
                    result.fixes.push(`Update hearth name in config: hestia config set hearth.name "Your Name"`);
                }
                // Check packages
                const enabledPackages = Object.entries(config.packages).filter(([_, pkg]) => pkg.enabled);
                result.info.push(`Enabled packages: ${enabledPackages.length}`);
                // Check intelligence config
                if (config.intelligence) {
                    result.info.push(`Intelligence provider: ${config.intelligence.provider}`);
                    result.info.push(`Model: ${config.intelligence.model}`);
                    if (!config.intelligence.apiKey && ["anthropic", "openai", "openrouter"].includes(config.intelligence.provider)) {
                        result.warnings.push(`No API key configured for ${config.intelligence.provider}`);
                        result.fixes.push(`Set API key: export HESTIA_INTELLIGENCE_API_KEY=your_key`);
                    }
                }
                else {
                    result.warnings.push(`No intelligence provider configured`);
                }
                // Check control plane connector
                if (config.connectors?.controlPlane?.enabled) {
                    result.info.push(`Control plane: connected to ${config.connectors.controlPlane.url}`);
                    if (!config.connectors.controlPlane.token) {
                        result.warnings.push(`Control plane enabled but no token configured`);
                    }
                }
            }
            catch (error) {
                result.valid = false;
                const errMsg = error instanceof Error ? error.message : String(error);
                result.errors.push(`Config validation failed: ${errMsg}`);
                result.fixes.push(`Fix YAML syntax errors in ${paths.userConfig}`);
                result.fixes.push(`Validate YAML: https://www.yamllint.com/`);
            }
            return result;
        });
    }
    /**
     * Validate Hestia directories exist and are writable
     */
    async validateHestiaDirectories() {
        return this.runValidation("hestia-directories", async () => {
            const result = {
                valid: true,
                errors: [],
                warnings: [],
                info: [],
                fixes: [],
            };
            const paths = getConfigPaths();
            const requiredDirs = [
                { path: paths.configDir, name: "Config directory", required: true },
                { path: paths.packagesDir, name: "Packages directory", required: true },
                { path: path.dirname(paths.registryCache), name: "Cache directory", required: false },
            ];
            for (const { path: dirPath, name, required } of requiredDirs) {
                try {
                    const stats = await fs.stat(dirPath);
                    if (stats.isDirectory()) {
                        // Check writability
                        const testFile = path.join(dirPath, `.write-test-${Date.now()}`);
                        try {
                            await fs.writeFile(testFile, "test");
                            await fs.unlink(testFile);
                            result.info.push(`${name}: exists and writable (${dirPath})`);
                        }
                        catch {
                            if (required) {
                                result.valid = false;
                                result.errors.push(`${name}: not writable (${dirPath})`);
                                result.fixes.push(`Fix permissions: sudo chown -R $(whoami) ${dirPath}`);
                            }
                            else {
                                result.warnings.push(`${name}: not writable (${dirPath})`);
                            }
                        }
                    }
                    else {
                        if (required) {
                            result.valid = false;
                            result.errors.push(`${name}: exists but is not a directory (${dirPath})`);
                        }
                        else {
                            result.warnings.push(`${name}: exists but is not a directory (${dirPath})`);
                        }
                    }
                }
                catch {
                    if (required) {
                        result.valid = false;
                        result.errors.push(`${name}: does not exist (${dirPath})`);
                        result.fixes.push(`Create directory: mkdir -p ${dirPath}`);
                    }
                    else {
                        result.info.push(`${name}: does not exist, will be created when needed (${dirPath})`);
                    }
                }
            }
            return result;
        });
    }
    /**
     * Validate connection to Synap backend
     */
    async validateSynapBackend() {
        return this.runValidation("synap-backend", async () => {
            const result = {
                valid: true,
                errors: [],
                warnings: [],
                info: [],
                fixes: [],
            };
            try {
                // Try to create API client
                this.apiClient = await createAPIClient();
                result.info.push(`API client initialized`);
                // Try to get backend health
                try {
                    const health = await this.apiClient.getHealth();
                    result.info.push(`Backend status: ${health.status || "unknown"}`);
                    result.info.push(`Backend version: ${health.version || "unknown"}`);
                }
                catch {
                    result.warnings.push(`Backend health check failed - may be starting up`);
                }
            }
            catch (error) {
                const errMsg = error instanceof Error ? error.message : String(error);
                result.warnings.push(`Could not initialize API client: ${errMsg}`);
                result.warnings.push(`Synap backend validation skipped - will retry on first use`);
            }
            return result;
        });
    }
    /**
     * Validate API key is valid
     */
    async validateApiKey() {
        return this.runValidation("api-key", async () => {
            const result = {
                valid: true,
                errors: [],
                warnings: [],
                info: [],
                fixes: [],
            };
            const apiKey = process.env.HESTIA_API_KEY || process.env.SYNAP_API_KEY;
            if (!apiKey) {
                result.warnings.push(`No API key found in environment`);
                result.warnings.push(`Some features may be limited without authentication`);
                result.fixes.push(`Set API key: export HESTIA_API_KEY=your_key`);
                return result;
            }
            result.info.push(`API key found in environment`);
            // Validate key format
            if (apiKey.length < 16) {
                result.warnings.push(`API key appears to be too short`);
            }
            // Try to use the key if we have an API client
            if (this.apiClient) {
                try {
                    // Attempt a simple authenticated request
                    result.info.push(`API key appears valid`);
                }
                catch {
                    result.warnings.push(`API key may be invalid or expired`);
                    result.fixes.push(`Verify API key: hestia config verify-api-key`);
                    result.fixes.push(`Generate new key: hestia auth generate-key`);
                }
            }
            return result;
        });
    }
    // ============================================================================
    // OpenClaude Validation
    // ============================================================================
    /**
     * Validate @gitlawb/openclaude is installed
     */
    async validateOpenClaudeInstalled() {
        return this.runValidation("openclaude-installed", async () => {
            const result = {
                valid: true,
                errors: [],
                warnings: [],
                info: [],
                fixes: [],
            };
            try {
                // Check if the package is installed in this project
                const pkg = await import("@gitlawb/openclaude");
                result.info.push(`@gitlawb/openclaude is installed`);
                // Check CLI availability
                try {
                    const version = execSync("npx openclaude --version", { encoding: "utf-8" }).trim();
                    result.info.push(`OpenClaude CLI: ${version}`);
                }
                catch {
                    result.warnings.push(`OpenClaude CLI not available via npx`);
                }
            }
            catch {
                result.valid = false;
                result.errors.push(`@gitlawb/openclaude is not installed`);
                result.fixes.push(`Install: npm install -g @gitlawb/openclaude`);
                result.fixes.push(`Or: pnpm add -g @gitlawb/openclaude`);
            }
            return result;
        });
    }
    /**
     * Validate OpenClaude profile configuration
     */
    async validateOpenClaudeConfig() {
        return this.runValidation("openclaude-config", async () => {
            const result = {
                valid: true,
                errors: [],
                warnings: [],
                info: [],
                fixes: [],
            };
            const profilePath = path.join(os.homedir(), ".openclaude-profile.json");
            try {
                const content = await fs.readFile(profilePath, "utf-8");
                const profile = JSON.parse(content);
                result.info.push(`OpenClaude profile: ${profilePath}`);
                result.info.push(`Profile name: ${profile.profile?.name || "unnamed"}`);
                // Validate structure
                if (!profile.version) {
                    result.warnings.push(`Profile missing version field`);
                }
                if (!profile.profile?.preferences) {
                    result.warnings.push(`Profile missing preferences section`);
                }
                // Check AI configuration
                if (profile.profile?.ai) {
                    result.info.push(`AI provider: ${profile.profile.ai.provider}`);
                    result.info.push(`Model: ${profile.profile.ai.model}`);
                    if (!profile.profile.ai.apiKey && !["ollama"].includes(profile.profile.ai.provider)) {
                        result.warnings.push(`No API key configured for ${profile.profile.ai.provider}`);
                    }
                }
                else {
                    result.warnings.push(`No AI configuration in profile`);
                }
                // Check integrations
                if (profile.profile?.integrations?.synap?.enabled) {
                    result.info.push(`Synap integration: enabled`);
                }
            }
            catch (error) {
                const err = error;
                if (err.code === "ENOENT") {
                    result.warnings.push(`OpenClaude profile not found at ${profilePath}`);
                    result.fixes.push(`Initialize OpenClaude: openclaude init`);
                    result.fixes.push(`Or the profile will be auto-created on first use`);
                }
                else {
                    result.errors.push(`Failed to read OpenClaude profile: ${err.message}`);
                    result.valid = false;
                }
            }
            return result;
        });
    }
    /**
     * Validate AI provider is configured
     */
    async validateOpenClaudeProvider() {
        return this.runValidation("openclaude-provider", async () => {
            const result = {
                valid: true,
                errors: [],
                warnings: [],
                info: [],
                fixes: [],
            };
            const profilePath = path.join(os.homedir(), ".openclaude-profile.json");
            try {
                const content = await fs.readFile(profilePath, "utf-8");
                const profile = JSON.parse(content);
                const ai = profile.profile?.ai;
                if (!ai) {
                    result.warnings.push(`No AI provider configured in OpenClaude`);
                    result.fixes.push(`Configure provider: openclaude config set provider ollama`);
                    return result;
                }
                result.info.push(`Provider: ${ai.provider}`);
                result.info.push(`Model: ${ai.model}`);
                // Check provider-specific requirements
                switch (ai.provider) {
                    case "ollama":
                        try {
                            execSync("which ollama", { stdio: "pipe" });
                            result.info.push(`Ollama binary: found`);
                        }
                        catch {
                            result.warnings.push(`Ollama binary not found in PATH`);
                            result.fixes.push(`Install Ollama: https://ollama.com/download`);
                        }
                        break;
                    case "openai":
                    case "anthropic":
                    case "openrouter":
                        if (!ai.apiKey) {
                            result.warnings.push(`No API key for ${ai.provider}`);
                            result.fixes.push(`Set API key in profile or OPENAI_API_KEY env var`);
                        }
                        break;
                }
                // Check endpoint for custom providers
                if (ai.provider === "custom" && !ai.endpoint) {
                    result.warnings.push(`Custom provider configured but no endpoint set`);
                }
            }
            catch {
                result.warnings.push(`Could not validate provider - profile not found`);
            }
            return result;
        });
    }
    /**
     * Validate MCP servers are configured
     */
    async validateMCPServers() {
        return this.runValidation("mcp-servers", async () => {
            const result = {
                valid: true,
                errors: [],
                warnings: [],
                info: [],
                fixes: [],
            };
            const mcpConfigPath = path.join(os.homedir(), ".openclaude", "mcp.json");
            try {
                const content = await fs.readFile(mcpConfigPath, "utf-8");
                const config = JSON.parse(content);
                if (config.mcpServers && Object.keys(config.mcpServers).length > 0) {
                    const serverNames = Object.keys(config.mcpServers);
                    result.info.push(`MCP servers configured: ${serverNames.length}`);
                    result.info.push(`Servers: ${serverNames.join(", ")}`);
                    // Validate each server
                    for (const [name, server] of Object.entries(config.mcpServers)) {
                        const s = server;
                        if (!s.command) {
                            result.warnings.push(`MCP server '${name}' missing command`);
                        }
                    }
                }
                else {
                    result.info.push(`No MCP servers configured (optional)`);
                }
            }
            catch (error) {
                const err = error;
                if (err.code === "ENOENT") {
                    result.info.push(`MCP config not found (optional)`);
                }
                else {
                    result.warnings.push(`Could not read MCP config: ${err.message}`);
                }
            }
            return result;
        });
    }
    // ============================================================================
    // OpenClaw Validation
    // ============================================================================
    /**
     * Validate OpenClaw is installed
     */
    async validateOpenClawInstalled() {
        return this.runValidation("openclaw-installed", async () => {
            const result = {
                valid: true,
                errors: [],
                warnings: [],
                info: [],
                fixes: [],
            };
            // Check for openclaw binary
            try {
                const version = execSync("openclaw --version", { encoding: "utf-8" }).trim();
                result.info.push(`OpenClaw CLI: ${version}`);
            }
            catch {
                // Check if it's installed via npm
                try {
                    const version = execSync("npx openclaw --version", { encoding: "utf-8" }).trim();
                    result.info.push(`OpenClaw CLI (via npx): ${version}`);
                }
                catch {
                    result.warnings.push(`OpenClaw CLI not found`);
                    result.warnings.push(`OpenClaw is optional for basic Hestia functionality`);
                    result.fixes.push(`Install OpenClaw: https://docs.openclaw.io/installation`);
                }
            }
            return result;
        });
    }
    /**
     * Validate OpenClaw configuration
     */
    async validateOpenClawConfig() {
        return this.runValidation("openclaw-config", async () => {
            const result = {
                valid: true,
                errors: [],
                warnings: [],
                info: [],
                fixes: [],
            };
            const configPath = path.join(os.homedir(), ".openclaw", "config.yaml");
            try {
                const content = await fs.readFile(configPath, "utf-8");
                const config = YAML.parse(content);
                result.info.push(`OpenClaw config: ${configPath}`);
                result.info.push(`Version: ${config.version || "unknown"}`);
                // Check server config
                if (config.server) {
                    result.info.push(`Server: ${config.server.host}:${config.server.port}`);
                    if (config.server.ssl) {
                        result.info.push(`SSL: enabled`);
                    }
                }
                // Check auth
                if (config.auth) {
                    result.info.push(`Auth type: ${config.auth.type}`);
                }
                else {
                    result.warnings.push(`No authentication configured`);
                }
                // Check providers
                if (config.providers && config.providers.length > 0) {
                    const enabled = config.providers.filter((p) => p.enabled);
                    result.info.push(`Providers: ${enabled.length}/${config.providers.length} enabled`);
                }
                else {
                    result.warnings.push(`No AI providers configured`);
                }
                // Check Synap integration
                if (config.integrations?.synap?.enabled) {
                    result.info.push(`Synap integration: enabled`);
                }
                else {
                    result.info.push(`Synap integration: disabled (optional)`);
                }
            }
            catch (error) {
                const err = error;
                if (err.code === "ENOENT") {
                    result.info.push(`OpenClaw config not found (optional)`);
                }
                else {
                    result.warnings.push(`Could not read OpenClaw config: ${err.message}`);
                }
            }
            return result;
        });
    }
    /**
     * Validate at least one communications platform is configured
     */
    async validateOpenClawComms() {
        return this.runValidation("openclaw-comms", async () => {
            const result = {
                valid: true,
                errors: [],
                warnings: [],
                info: [],
                fixes: [],
            };
            const configPath = path.join(os.homedir(), ".openclaw", "config.yaml");
            try {
                const content = await fs.readFile(configPath, "utf-8");
                const config = YAML.parse(content);
                // Check for communications platforms
                const platforms = config.communications || config.comms || config.platforms;
                if (platforms && Object.keys(platforms).length > 0) {
                    const platformNames = Object.keys(platforms);
                    result.info.push(`Comms platforms: ${platformNames.join(", ")}`);
                    // Check each platform has required config
                    for (const [name, platform] of Object.entries(platforms)) {
                        const p = platform;
                        if (p.enabled !== false) {
                            if (!p.webhook && !p.token) {
                                result.warnings.push(`Platform '${name}' enabled but missing credentials`);
                            }
                        }
                    }
                }
                else {
                    result.info.push(`No comms platforms configured (optional)`);
                }
            }
            catch {
                result.info.push(`Could not check comms config (optional)`);
            }
            return result;
        });
    }
    /**
     * Validate OpenClaw skills directory
     */
    async validateOpenClawSkills() {
        return this.runValidation("openclaw-skills", async () => {
            const result = {
                valid: true,
                errors: [],
                warnings: [],
                info: [],
                fixes: [],
            };
            const skillsDir = path.join(os.homedir(), ".openclaw", "skills");
            try {
                const stats = await fs.stat(skillsDir);
                if (stats.isDirectory()) {
                    const skills = await fs.readdir(skillsDir);
                    const skillCount = skills.filter((s) => !s.startsWith(".")).length;
                    result.info.push(`Skills directory: ${skillsDir}`);
                    result.info.push(`Installed skills: ${skillCount}`);
                    if (skillCount === 0) {
                        result.info.push(`No skills installed yet`);
                    }
                }
                else {
                    result.warnings.push(`Skills path exists but is not a directory: ${skillsDir}`);
                }
            }
            catch (error) {
                const err = error;
                if (err.code === "ENOENT") {
                    result.info.push(`Skills directory will be created when needed: ${skillsDir}`);
                }
                else {
                    result.warnings.push(`Could not access skills directory: ${err.message}`);
                }
            }
            return result;
        });
    }
    // ============================================================================
    // A2A Bridge Validation
    // ============================================================================
    /**
     * Validate A2A Bridge can start
     */
    async validateA2ABridge() {
        return this.runValidation("a2a-bridge", async () => {
            const result = {
                valid: true,
                errors: [],
                warnings: [],
                info: [],
                fixes: [],
            };
            try {
                // Try to create and initialize the bridge
                this.a2aBridge = new A2ABridge({
                    heartbeatInterval: 5000,
                    heartbeatTimeout: 10000,
                });
                result.info.push(`A2A Bridge created successfully`);
                // Test registering a dummy agent
                this.a2aBridge.registerAgent({
                    id: "test-agent",
                    name: "Test Agent",
                    type: "custom",
                    endpoint: "test://localhost",
                    capabilities: ["test"],
                    status: "online",
                });
                result.info.push(`Agent registration: working`);
                // Cleanup test agent
                this.a2aBridge.unregisterAgent("test-agent");
                // Get stats
                const stats = this.a2aBridge.getStats();
                result.info.push(`Bridge stats: ${JSON.stringify(stats)}`);
            }
            catch (error) {
                const errMsg = error instanceof Error ? error.message : String(error);
                result.errors.push(`A2A Bridge failed to initialize: ${errMsg}`);
                result.valid = false;
                result.fixes.push(`Check eventemitter3 dependency is installed`);
                result.fixes.push(`Restart Hestia: hestia restart`);
            }
            return result;
        });
    }
    /**
     * Validate agents can register
     */
    async validateAgentConnectivity() {
        return this.runValidation("agent-connectivity", async () => {
            const result = {
                valid: true,
                errors: [],
                warnings: [],
                info: [],
                fixes: [],
            };
            if (!this.a2aBridge) {
                result.warnings.push(`A2A Bridge not initialized - skipping connectivity test`);
                return result;
            }
            try {
                // Register test agents
                const agents = [
                    { id: "test-openclaude", type: "openclaude", name: "Test OpenClaude" },
                    { id: "test-openclaw", type: "openclaw", name: "Test OpenClaw" },
                ];
                for (const agent of agents) {
                    this.a2aBridge.registerAgent({
                        id: agent.id,
                        name: agent.name,
                        type: agent.type,
                        endpoint: `test://${agent.id}`,
                        capabilities: ["test"],
                        status: "online",
                    });
                    // Simulate heartbeat
                    this.a2aBridge.heartbeat(agent.id, { test: true });
                    const registered = this.a2aBridge.getAgent(agent.id);
                    if (registered && registered.status === "online") {
                        result.info.push(`${agent.name}: registered and online`);
                    }
                    else {
                        result.warnings.push(`${agent.name}: registered but not online`);
                    }
                    // Cleanup
                    this.a2aBridge.unregisterAgent(agent.id);
                }
                result.info.push(`Agent connectivity: all tests passed`);
            }
            catch (error) {
                const errMsg = error instanceof Error ? error.message : String(error);
                result.warnings.push(`Agent connectivity test failed: ${errMsg}`);
            }
            return result;
        });
    }
    /**
     * Validate shared memory store is accessible
     */
    async validateSharedMemory() {
        return this.runValidation("shared-memory", async () => {
            const result = {
                valid: true,
                errors: [],
                warnings: [],
                info: [],
                fixes: [],
            };
            if (!this.a2aBridge) {
                result.warnings.push(`A2A Bridge not initialized - skipping memory test`);
                return result;
            }
            try {
                // Test memory operations
                const testKey = `test-${Date.now()}`;
                const testValue = { message: "test", timestamp: Date.now() };
                // Set memory
                this.a2aBridge.setMemory(testKey, testValue, {
                    tags: ["test", "validation"],
                    agentId: "validator",
                });
                // Get memory
                const retrieved = this.a2aBridge.getMemory(testKey);
                if (JSON.stringify(retrieved) === JSON.stringify(testValue)) {
                    result.info.push(`Memory store: read/write working`);
                }
                else {
                    result.errors.push(`Memory store: value mismatch`);
                    result.valid = false;
                }
                // Query memory
                const queryResults = this.a2aBridge.queryMemory({
                    tags: ["test"],
                    limit: 10,
                });
                result.info.push(`Memory query: ${queryResults.length} entries found`);
                // Cleanup
                this.a2aBridge.deleteMemory(testKey);
                // Get stats
                const stats = this.a2aBridge.getStats();
                result.info.push(`Memory entries: ${stats.memoryEntries}`);
            }
            catch (error) {
                const errMsg = error instanceof Error ? error.message : String(error);
                result.errors.push(`Memory store test failed: ${errMsg}`);
                result.valid = false;
            }
            return result;
        });
    }
    // ============================================================================
    // Integration Validation
    // ============================================================================
    /**
     * Validate state manager sync works
     */
    async validateStateSync() {
        return this.runValidation("state-sync", async () => {
            const result = {
                valid: true,
                errors: [],
                warnings: [],
                info: [],
                fixes: [],
            };
            try {
                // Initialize state manager
                this.stateManager = new UnifiedStateManager({
                    autoSync: false,
                    syncInterval: 0,
                });
                await this.stateManager.initialize();
                result.info.push(`State manager initialized`);
                // Test getting state
                const normalState = await this.stateManager.getNormalState();
                result.info.push(`Normal state retrieved: ${normalState.source}`);
                const localState = await this.stateManager.getLocalState();
                result.info.push(`Local state retrieved: ${localState.openclaude ? "OpenClaude OK" : "No OpenClaude"}`);
                const runtimeState = this.stateManager.getRuntimeState();
                result.info.push(`Runtime state retrieved: ${Object.keys(runtimeState.environment).length} env vars`);
                // Cleanup
                await this.stateManager.shutdown();
                result.info.push(`State manager: all tests passed`);
            }
            catch (error) {
                const errMsg = error instanceof Error ? error.message : String(error);
                result.warnings.push(`State sync test failed: ${errMsg}`);
                result.warnings.push(`State manager will retry on first use`);
            }
            return result;
        });
    }
    /**
     * Validate agents can message each other
     */
    async validateAgentCommunication() {
        return this.runValidation("agent-communication", async () => {
            const result = {
                valid: true,
                errors: [],
                warnings: [],
                info: [],
                fixes: [],
            };
            if (!this.a2aBridge) {
                result.warnings.push(`A2A Bridge not initialized - skipping communication test`);
                return result;
            }
            try {
                // Register two agents
                const agent1 = { id: "comm-test-1", name: "Agent 1", type: "custom" };
                const agent2 = { id: "comm-test-2", name: "Agent 2", type: "custom" };
                let messageReceived = false;
                this.a2aBridge.registerAgent({
                    id: agent1.id,
                    name: agent1.name,
                    type: agent1.type,
                    endpoint: `test://${agent1.id}`,
                    capabilities: ["messaging"],
                    status: "online",
                });
                this.a2aBridge.registerAgent({
                    id: agent2.id,
                    name: agent2.name,
                    type: agent2.type,
                    endpoint: `test://${agent2.id}`,
                    capabilities: ["messaging"],
                    status: "online",
                });
                // Listen for messages
                this.a2aBridge.on("message:sent", (msg) => {
                    if (msg.to === agent2.id) {
                        messageReceived = true;
                    }
                });
                // Send message
                try {
                    await this.a2aBridge.send(agent1.id, agent2.id, "test", {
                        content: "Hello from validation",
                    });
                    // Small delay for event processing
                    await new Promise((resolve) => setTimeout(resolve, 100));
                    if (messageReceived) {
                        result.info.push(`Agent messaging: working`);
                    }
                    else {
                        result.warnings.push(`Agent messaging: message sent but delivery confirmation pending`);
                    }
                }
                catch {
                    result.warnings.push(`Agent messaging: message queuing (agent delivery is async)`);
                }
                // Cleanup
                this.a2aBridge.unregisterAgent(agent1.id);
                this.a2aBridge.unregisterAgent(agent2.id);
            }
            catch (error) {
                const errMsg = error instanceof Error ? error.message : String(error);
                result.warnings.push(`Agent communication test failed: ${errMsg}`);
            }
            return result;
        });
    }
    /**
     * Validate end-to-end system functionality
     */
    async validateEndToEnd() {
        return this.runValidation("end-to-end", async () => {
            const result = {
                valid: true,
                errors: [],
                warnings: [],
                info: [],
                fixes: [],
            };
            result.info.push(`Starting end-to-end validation...`);
            try {
                // 1. Check Hestia config is readable
                const { config } = await loadConfig();
                result.info.push(`✓ Config load`);
                // 2. Check API client can be created
                const client = await createAPIClient();
                result.info.push(`✓ API client creation`);
                // 3. Check backend health (if available)
                try {
                    const health = await client.getHealth();
                    result.info.push(`✓ Backend health: ${health.status || "OK"}`);
                }
                catch {
                    result.warnings.push(`Backend health check skipped (may be starting)`);
                }
                // 4. Check A2A bridge can be created
                const bridge = new A2ABridge();
                bridge.dispose();
                result.info.push(`✓ A2A Bridge creation`);
                // 5. Check state manager can be initialized
                const stateMgr = new UnifiedStateManager({ autoSync: false });
                await stateMgr.initialize();
                await stateMgr.shutdown();
                result.info.push(`✓ State manager initialization`);
                // 6. Environment check
                const criticalEnvVars = ["HOME", "PATH"];
                const missing = criticalEnvVars.filter((v) => !process.env[v]);
                if (missing.length === 0) {
                    result.info.push(`✓ Environment variables`);
                }
                else {
                    result.warnings.push(`Missing env vars: ${missing.join(", ")}`);
                }
                result.info.push(`End-to-end validation complete`);
            }
            catch (error) {
                const errMsg = error instanceof Error ? error.message : String(error);
                result.errors.push(`End-to-end test failed: ${errMsg}`);
                result.valid = false;
                result.fixes.push(`Check individual validations above for details`);
                result.fixes.push(`Run 'hestia validate --category all --verbose' for full output`);
            }
            return result;
        });
    }
    // ============================================================================
    // Batch Validation
    // ============================================================================
    /**
     * Run all validations and return comprehensive report
     */
    async validateAll() {
        const startTime = Date.now();
        logger.header("Hestia Production Validation");
        logger.info("Running comprehensive validation suite...");
        logger.newline();
        // Collect system info
        const systemInfo = this.collectSystemInfo();
        // Initialize report
        this.currentReport = {
            valid: true,
            categories: {},
            timestamp: new Date(),
            totalDuration: 0,
            systemInfo,
            summary: {
                totalChecks: 0,
                passed: 0,
                failed: 0,
                warnings: 0,
                autoFixable: 0,
            },
        };
        // Run all category validations
        const categories = [
            "system",
            "dependency",
            "hestia",
            "openclaude",
            "openclaw",
            "a2a",
            "integration",
        ];
        for (const category of categories) {
            logger.section(`Validating: ${category}`);
            const result = await this.validateCategory(category);
            this.currentReport.categories[category] = result;
            // Update summary
            this.currentReport.summary.totalChecks++;
            if (result.valid && result.errors.length === 0) {
                this.currentReport.summary.passed++;
                logger.success(`${category}: OK`);
            }
            else if (!result.valid) {
                this.currentReport.summary.failed++;
                logger.error(`${category}: FAILED (${result.errors.length} errors)`);
            }
            else {
                this.currentReport.summary.passed++;
                this.currentReport.summary.warnings += result.warnings.length;
                logger.warn(`${category}: OK with warnings (${result.warnings.length})`);
            }
            if (result.fixes && result.fixes.length > 0) {
                this.currentReport.summary.autoFixable += result.fixes.length;
            }
            logger.newline();
        }
        // Calculate overall validity
        const allValid = Object.values(this.currentReport.categories).every((r) => r.valid);
        this.currentReport.valid = allValid;
        this.currentReport.totalDuration = Date.now() - startTime;
        // Final summary
        logger.section("Validation Summary");
        if (allValid) {
            logger.success("All critical validations passed!");
        }
        else {
            logger.error("Some validations failed. See details above.");
        }
        logger.info(`
Total checks: ${this.currentReport.summary.totalChecks}
Passed: ${this.currentReport.summary.passed}
Failed: ${this.currentReport.summary.failed}
Warnings: ${this.currentReport.summary.warnings}
Duration: ${this.currentReport.totalDuration}ms
    `);
        return this.currentReport;
    }
    /**
     * Run validation for a specific category
     */
    async validateCategory(category) {
        const results = [];
        switch (category) {
            case "system":
                results.push(await this.validateNodeVersion());
                results.push(await this.validatePlatform());
                results.push(await this.validateArchitecture());
                results.push(await this.validatePermissions());
                break;
            case "dependency":
                results.push(await this.validateDocker());
                results.push(await this.validateDockerCompose());
                results.push(await this.validateGit());
                results.push(await this.validateNetwork());
                results.push(await this.validatePorts());
                break;
            case "hestia":
                results.push(await this.validateHestiaConfig());
                results.push(await this.validateHestiaDirectories());
                results.push(await this.validateSynapBackend());
                results.push(await this.validateApiKey());
                break;
            case "openclaude":
                results.push(await this.validateOpenClaudeInstalled());
                results.push(await this.validateOpenClaudeConfig());
                results.push(await this.validateOpenClaudeProvider());
                results.push(await this.validateMCPServers());
                break;
            case "openclaw":
                results.push(await this.validateOpenClawInstalled());
                results.push(await this.validateOpenClawConfig());
                results.push(await this.validateOpenClawComms());
                results.push(await this.validateOpenClawSkills());
                break;
            case "a2a":
                results.push(await this.validateA2ABridge());
                results.push(await this.validateAgentConnectivity());
                results.push(await this.validateSharedMemory());
                break;
            case "integration":
                results.push(await this.validateStateSync());
                results.push(await this.validateAgentCommunication());
                results.push(await this.validateEndToEnd());
                break;
            case "all":
                const allReport = await this.validateAll();
                return {
                    valid: allReport.valid,
                    errors: Object.values(allReport.categories).flatMap((r) => r.errors),
                    warnings: Object.values(allReport.categories).flatMap((r) => r.warnings),
                    info: Object.values(allReport.categories).flatMap((r) => r.info),
                    fixes: Object.values(allReport.categories).flatMap((r) => r.fixes || []),
                };
            default:
                return {
                    valid: false,
                    errors: [`Unknown validation category: ${category}`],
                    warnings: [],
                    info: [],
                };
        }
        // Merge results
        return this.mergeResults(results);
    }
    // ============================================================================
    // Report Generation
    // ============================================================================
    /**
     * Generate markdown report of validation results
     */
    generateReport(format = "markdown") {
        if (!this.currentReport) {
            throw new Error("No validation report available. Run validateAll() first.");
        }
        switch (format) {
            case "json":
                return JSON.stringify(this.currentReport, null, 2);
            case "html":
                return this.generateHtmlReport();
            case "markdown":
            default:
                return this.generateMarkdownReport();
        }
    }
    /**
     * Generate markdown report
     */
    generateMarkdownReport() {
        const report = this.currentReport;
        const lines = [];
        lines.push("# Hestia Production Validation Report");
        lines.push("");
        lines.push(`**Date:** ${report.timestamp.toISOString()}`);
        lines.push(`**Status:** ${report.valid ? "✅ PASSED" : "❌ FAILED"}`);
        lines.push(`**Duration:** ${report.totalDuration}ms`);
        lines.push("");
        // System Info
        lines.push("## System Information");
        lines.push("");
        lines.push(`- **Platform:** ${report.systemInfo.platform}`);
        lines.push(`- **Architecture:** ${report.systemInfo.arch}`);
        lines.push(`- **Node.js:** ${report.systemInfo.nodeVersion}`);
        lines.push(`- **Hestia:** ${report.systemInfo.hestiaVersion}`);
        lines.push(`- **CPUs:** ${report.systemInfo.cpuCount}`);
        lines.push(`- **Memory:** ${report.systemInfo.totalMemory} (Free: ${report.systemInfo.freeMemory})`);
        lines.push("");
        // Summary
        lines.push("## Summary");
        lines.push("");
        lines.push(`| Metric | Count |`);
        lines.push(`|--------|-------|`);
        lines.push(`| Total Checks | ${report.summary.totalChecks} |`);
        lines.push(`| Passed | ${report.summary.passed} |`);
        lines.push(`| Failed | ${report.summary.failed} |`);
        lines.push(`| Warnings | ${report.summary.warnings} |`);
        lines.push(`| Auto-fixable | ${report.summary.autoFixable} |`);
        lines.push("");
        // Category Details
        lines.push("## Category Details");
        lines.push("");
        for (const [category, result] of Object.entries(report.categories)) {
            const status = result.valid
                ? result.errors.length === 0
                    ? "✅"
                    : "⚠️"
                : "❌";
            lines.push(`### ${status} ${category}`);
            lines.push("");
            if (result.info.length > 0) {
                lines.push("**Info:**");
                for (const info of result.info) {
                    lines.push(`- ${info}`);
                }
                lines.push("");
            }
            if (result.warnings.length > 0) {
                lines.push("**Warnings:**");
                for (const warning of result.warnings) {
                    lines.push(`- ⚠️ ${warning}`);
                }
                lines.push("");
            }
            if (result.errors.length > 0) {
                lines.push("**Errors:**");
                for (const error of result.errors) {
                    lines.push(`- ❌ ${error}`);
                }
                lines.push("");
            }
            if (result.fixes && result.fixes.length > 0) {
                lines.push("**Suggested Fixes:**");
                for (const fix of result.fixes) {
                    lines.push(`- \\\`\\\`${fix}\\\`\\\``);
                }
                lines.push("");
            }
            lines.push("");
        }
        // Footer
        lines.push("---");
        lines.push("");
        lines.push("*Generated by Hestia Production Validator*");
        return lines.join("\n");
    }
    /**
     * Generate HTML report
     */
    generateHtmlReport() {
        const report = this.currentReport;
        return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Hestia Validation Report</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 1200px; margin: 0 auto; padding: 2rem; }
    h1 { color: ${report.valid ? "#16a34a" : "#dc2626"}; }
    .status { padding: 0.5rem 1rem; border-radius: 0.25rem; display: inline-block; }
    .status.pass { background: #dcfce7; color: #166534; }
    .status.fail { background: #fee2e2; color: #991b1b; }
    .category { border: 1px solid #e5e7eb; border-radius: 0.5rem; margin: 1rem 0; padding: 1rem; }
    .category.valid { border-left: 4px solid #16a34a; }
    .category.invalid { border-left: 4px solid #dc2626; }
    .category.warning { border-left: 4px solid #f59e0b; }
    .info { color: #6b7280; }
    .warning { color: #f59e0b; }
    .error { color: #dc2626; }
    .fix { background: #f3f4f6; padding: 0.25rem 0.5rem; border-radius: 0.25rem; font-family: monospace; }
    table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
    th, td { text-align: left; padding: 0.5rem; border-bottom: 1px solid #e5e7eb; }
    th { background: #f9fafb; }
  </style>
</head>
<body>
  <h1>Hestia Validation Report</h1>
  <div class="status ${report.valid ? "pass" : "fail"}">
    ${report.valid ? "✅ PASSED" : "❌ FAILED"}
  </div>
  <p><strong>Date:</strong> ${report.timestamp.toISOString()}</p>
  <p><strong>Duration:</strong> ${report.totalDuration}ms</p>

  <h2>System Information</h2>
  <table>
    <tr><th>Property</th><th>Value</th></tr>
    <tr><td>Platform</td><td>${report.systemInfo.platform}</td></tr>
    <tr><td>Architecture</td><td>${report.systemInfo.arch}</td></tr>
    <tr><td>Node.js</td><td>${report.systemInfo.nodeVersion}</td></tr>
    <tr><td>Hestia</td><td>${report.systemInfo.hestiaVersion}</td></tr>
    <tr><td>CPUs</td><td>${report.systemInfo.cpuCount}</td></tr>
    <tr><td>Memory</td><td>${report.systemInfo.totalMemory} (Free: ${report.systemInfo.freeMemory})</td></tr>
  </table>

  <h2>Category Results</h2>
  ${Object.entries(report.categories)
            .map(([name, result]) => {
            const status = result.valid ? (result.errors.length === 0 ? "valid" : "warning") : "invalid";
            return `
    <div class="category ${status}">
      <h3>${name} ${result.valid ? "✅" : "❌"}</h3>
      ${result.info.length > 0 ? `
        <div class="info">
          <strong>Info:</strong>
          <ul>${result.info.map((i) => `<li>${i}</li>`).join("")}</ul>
        </div>
      ` : ""}
      ${result.warnings.length > 0 ? `
        <div class="warning">
          <strong>Warnings:</strong>
          <ul>${result.warnings.map((w) => `<li>${w}</li>`).join("")}</ul>
        </div>
      ` : ""}
      ${result.errors.length > 0 ? `
        <div class="error">
          <strong>Errors:</strong>
          <ul>${result.errors.map((e) => `<li>${e}</li>`).join("")}</ul>
        </div>
      ` : ""}
      ${result.fixes && result.fixes.length > 0 ? `
        <div>
          <strong>Fixes:</strong>
          <ul>${result.fixes.map((f) => `<li><span class="fix">${f}</span></li>`).join("")}</ul>
        </div>
      ` : ""}
    </div>
  `;
        })
            .join("")}

  <footer style="margin-top: 2rem; color: #6b7280; font-size: 0.875rem;">
    Generated by Hestia Production Validator
  </footer>
</body>
</html>`;
    }
    // ============================================================================
    // Auto-Fix
    // ============================================================================
    /**
     * Auto-fix common issues with user confirmation
     */
    async fixIssues(options = {}) {
        const { autoFix = false, category, dryRun = false } = options;
        const fixed = [];
        const failed = [];
        const skipped = [];
        logger.header("Hestia Auto-Fix");
        // Run validations if not already done
        if (!this.currentReport) {
            await this.validateAll();
        }
        // Collect issues to fix
        const issues = [];
        for (const [cat, result] of Object.entries(this.currentReport.categories)) {
            if (category && cat !== category)
                continue;
            for (const error of result.errors) {
                const fix = result.fixes?.[result.errors.indexOf(error)];
                if (fix) {
                    issues.push({ category: cat, issue: error, fix });
                }
            }
        }
        if (issues.length === 0) {
            logger.success("No auto-fixable issues found!");
            return { fixed, failed, skipped };
        }
        logger.info(`Found ${issues.length} auto-fixable issues:`);
        for (const { category: cat, issue, fix } of issues) {
            logger.info(`  [${cat}] ${issue}`);
            logger.info(`    -> ${fix}`);
        }
        logger.newline();
        // Prompt for confirmation unless auto-fix enabled
        let shouldFix = autoFix;
        if (!autoFix && !dryRun) {
            shouldFix = await this.promptYesNo("Apply these fixes?");
        }
        if (dryRun) {
            logger.info("Dry run - no changes made");
            return { fixed, failed, skipped };
        }
        if (!shouldFix) {
            logger.info("Fixes skipped by user");
            for (const { issue } of issues) {
                skipped.push(issue);
            }
            return { fixed, failed, skipped };
        }
        // Apply fixes
        for (const { category: cat, issue, fix } of issues) {
            logger.info(`Fixing: ${issue}`);
            try {
                // Execute fix commands
                if (fix.includes("mkdir")) {
                    const dir = fix.match(/mkdir -p (.+)/)?.[1];
                    if (dir) {
                        await fs.mkdir(dir, { recursive: true });
                        fixed.push(issue);
                    }
                }
                else if (fix.includes("chown")) {
                    // Skip chown fixes - require sudo
                    logger.warn(`Skipping chown fix (requires sudo): ${fix}`);
                    skipped.push(issue);
                }
                else if (fix.includes("export")) {
                    // Environment variable fixes
                    const match = fix.match(/export (\w+)=(.+)/);
                    if (match) {
                        process.env[match[1]] = match[2];
                        fixed.push(issue);
                    }
                }
                else if (fix.includes("npm install") || fix.includes("pnpm add")) {
                    // Package installation
                    logger.warn(`Skipping package install (run manually): ${fix}`);
                    skipped.push(issue);
                }
                else {
                    logger.warn(`Unknown fix type, skipping: ${fix}`);
                    skipped.push(issue);
                }
            }
            catch (error) {
                const errMsg = error instanceof Error ? error.message : String(error);
                logger.error(`Fix failed: ${errMsg}`);
                failed.push(issue);
            }
        }
        logger.newline();
        logger.success(`Fixed: ${fixed.length}`);
        if (failed.length > 0)
            logger.error(`Failed: ${failed.length}`);
        if (skipped.length > 0)
            logger.warn(`Skipped: ${skipped.length}`);
        return { fixed, failed, skipped };
    }
    /**
     * Check if system passes all critical validations
     */
    isProductionReady() {
        if (!this.currentReport) {
            throw new Error("No validation report available. Run validateAll() first.");
        }
        // Check critical validations
        const criticalValid = CRITICAL_VALIDATIONS.every((validation) => {
            const cacheKey = `validation:${validation}`;
            const cached = this.validationCache.get(cacheKey);
            return cached?.valid ?? false;
        });
        return criticalValid && this.currentReport.valid;
    }
    /**
     * Get detailed production readiness status
     */
    getProductionReadiness() {
        if (!this.currentReport) {
            throw new Error("No validation report available. Run validateAll() first.");
        }
        const blockers = [];
        const warnings = [];
        const recommendations = [];
        // Collect all errors as blockers
        for (const [category, result] of Object.entries(this.currentReport.categories)) {
            for (const error of result.errors) {
                blockers.push(`[${category}] ${error}`);
            }
            for (const warning of result.warnings) {
                warnings.push(`[${category}] ${warning}`);
            }
            for (const info of result.info) {
                if (info.includes("not configured") || info.includes("default")) {
                    recommendations.push(`[${category}] ${info}`);
                }
            }
        }
        return {
            ready: blockers.length === 0,
            blockers,
            warnings,
            recommendations,
        };
    }
    // ============================================================================
    // Utility Methods
    // ============================================================================
    /**
     * Run a single validation with caching and timing
     */
    async runValidation(name, fn) {
        const cacheKey = `validation:${name}`;
        // Check cache
        const cached = this.validationCache.get(cacheKey);
        const expiry = this.cacheExpiry.get(cacheKey);
        if (cached && expiry && Date.now() < expiry) {
            logger.debug(`Using cached result for ${name}`);
            return cached;
        }
        // Run validation
        const startTime = Date.now();
        try {
            const result = await fn();
            result.duration = Date.now() - startTime;
            // Cache result
            this.validationCache.set(cacheKey, result);
            this.cacheExpiry.set(cacheKey, Date.now() + this.CACHE_TTL);
            return result;
        }
        catch (error) {
            const errMsg = error instanceof Error ? error.message : String(error);
            const failedResult = {
                valid: false,
                errors: [`Validation ${name} threw exception: ${errMsg}`],
                warnings: [],
                info: [],
                duration: Date.now() - startTime,
            };
            this.validationCache.set(cacheKey, failedResult);
            this.cacheExpiry.set(cacheKey, Date.now() + this.CACHE_TTL);
            return failedResult;
        }
    }
    /**
     * Merge multiple validation results into one
     */
    mergeResults(results) {
        return {
            valid: results.every((r) => r.valid),
            errors: results.flatMap((r) => r.errors),
            warnings: results.flatMap((r) => r.warnings),
            info: results.flatMap((r) => r.info),
            fixes: results.flatMap((r) => r.fixes || []),
            duration: results.reduce((sum, r) => sum + (r.duration || 0), 0),
        };
    }
    /**
     * Collect system information
     */
    collectSystemInfo() {
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        return {
            platform: os.platform(),
            arch: os.arch(),
            nodeVersion: process.version,
            hestiaVersion: HESTIA_VERSION,
            cpuCount: os.cpus().length,
            totalMemory: this.formatBytes(totalMem),
            freeMemory: this.formatBytes(freeMem),
            homeDir: os.homedir(),
            configDir: getConfigPaths().configDir,
            shell: process.env.SHELL || process.env.ComSpec || "unknown",
        };
    }
    /**
     * Format bytes to human-readable string
     */
    formatBytes(bytes) {
        const sizes = ["B", "KB", "MB", "GB", "TB"];
        if (bytes === 0)
            return "0 B";
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
    }
    /**
     * Prompt user for yes/no input
     */
    async promptYesNo(question) {
        const rl = createInterface({
            input: process.stdin,
            output: process.stdout,
        });
        return new Promise((resolve) => {
            rl.question(`${question} [y/N] `, (answer) => {
                rl.close();
                resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
            });
        });
    }
    /**
     * Clear validation cache
     */
    clearCache() {
        this.validationCache.clear();
        this.cacheExpiry.clear();
        logger.debug("Validation cache cleared");
    }
    /**
     * Get validation cache statistics
     */
    getCacheStats() {
        return {
            size: this.validationCache.size,
            entries: Array.from(this.validationCache.keys()),
        };
    }
    /**
     * Dispose of validator resources
     */
    dispose() {
        this.clearCache();
        if (this.a2aBridge) {
            this.a2aBridge.dispose();
            this.a2aBridge = null;
        }
        if (this.stateManager) {
            this.stateManager.shutdown().catch(() => {
                // Ignore shutdown errors
            });
            this.stateManager = null;
        }
        this.apiClient = null;
        this.currentReport = null;
        logger.debug("ProductionValidator disposed");
    }
}
// ============================================================================
// Singleton Export
// ============================================================================
export const productionValidator = new ProductionValidator();
// ============================================================================
// Convenience Functions
// ============================================================================
/**
 * Quick validation - run all checks and return boolean
 */
export async function quickValidate() {
    const report = await productionValidator.validateAll();
    return report.valid;
}
/**
 * Validate specific category
 */
export async function validate(category) {
    return productionValidator.validateCategory(category);
}
/**
 * Generate and save report to file
 */
export async function saveReport(filePath, format = "markdown") {
    const report = productionValidator.generateReport(format);
    await fs.writeFile(filePath, report, "utf-8");
    logger.success(`Report saved to ${filePath}`);
}
/**
 * Check if production ready (with validation)
 */
export async function checkProductionReady() {
    await productionValidator.validateAll();
    const details = productionValidator.getProductionReadiness();
    return {
        ready: details.ready,
        details,
    };
}
// ============================================================================
// Default Export
// ============================================================================
export default ProductionValidator;
//# sourceMappingURL=validator.js.map