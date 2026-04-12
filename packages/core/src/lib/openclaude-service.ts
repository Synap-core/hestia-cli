/**
 * Hestia CLI - OpenClaude Service
 *
 * Wraps @gitlawb/openclaude CLI and integrates it with Hestia infrastructure.
 * Provides process management, configuration translation, MCP server management,
 * and Synap Backend integration.
 */

import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { spawn, ChildProcess } from "child_process";
import { promisify } from "util";
import { exec } from "child_process";
import { logger, createLogger } from "./logger.js";
import { loadConfig, getConfigPaths, saveConfig, loadCredentials } from "./config.js";
import type { HestiaConfig, IntelligenceConfig, Logger } from "../types.js";

const execAsync = promisify(exec);

// ============================================================================
// Types
// ============================================================================

export interface OpenClaudeServiceOptions {
  /** Custom configuration path */
  configPath?: string;
  /** Custom logger instance */
  logger?: Logger;
  /** Auto-restart on crash */
  autoRestart?: boolean;
  /** Maximum restart attempts */
  maxRestarts?: number;
  /** Working directory for OpenClaude */
  workingDir?: string;
}

export interface OpenClaudeStatus {
  isRunning: boolean;
  pid?: number;
  uptime?: number;
  lastStartTime?: Date;
  restartCount: number;
  profileLoaded?: string;
  currentProvider?: string;
  errors: string[];
}

export interface MCPInstallConfig {
  /** MCP server name */
  name: string;
  /** Server command (e.g., "npx", "node", "python") */
  command: string;
  /** Arguments for the command */
  args?: string[];
  /** Environment variables */
  env?: Record<string, string>;
  /** Server URL if using SSE transport */
  url?: string;
}

export interface MCPInstalledServer {
  name: string;
  enabled: boolean;
  command: string;
  args: string[];
  transport: "stdio" | "sse";
}

export interface OpenClaudeProfile {
  version: string;
  name: string;
  provider: string;
  model: string;
  apiKey?: string;
  endpoint?: string;
  temperature?: number;
  maxTokens?: number;
  mcpServers?: Record<string, MCPInstalledServer>;
  hestiaIntegration?: {
    enabled: boolean;
    backendUrl?: string;
    apiKey?: string;
    workspaceId?: string;
  };
}

export interface ProviderConfig {
  provider: "ollama" | "openrouter" | "anthropic" | "openai" | "custom";
  model: string;
  endpoint?: string;
  apiKey?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface ExecuteResult {
  success: boolean;
  output?: string;
  error?: string;
  exitCode?: number;
}

// ============================================================================
// Service Implementation
// ============================================================================

export class OpenClaudeService {
  private process: ChildProcess | null = null;
  private status: OpenClaudeStatus;
  private options: Required<OpenClaudeServiceOptions>;
  private logger: Logger;
  private restartAttempts = 0;
  private startTime?: Date;
  private profilePath: string;
  private hestiaConfig?: HestiaConfig;

  constructor(options: OpenClaudeServiceOptions = {}) {
    this.options = {
      configPath: options.configPath,
      logger: options.logger || createLogger("openclaude"),
      autoRestart: options.autoRestart ?? true,
      maxRestarts: options.maxRestarts ?? 5,
      workingDir: options.workingDir || path.join(os.homedir(), ".openclaude"),
    };

    this.logger = this.options.logger;
    this.status = {
      isRunning: false,
      restartCount: 0,
      errors: [],
    };

    this.profilePath = path.join(this.options.workingDir, ".openclaude-profile.json");
  }

  // ==========================================================================
  // Lifecycle Management
  // ==========================================================================

  /**
   * Start OpenClaude with Hestia configuration
   */
  async start(startOptions?: { profile?: string; command?: string }): Promise<void> {
    if (this.process) {
      this.logger.warn("OpenClaude is already running");
      return;
    }

    try {
      // Load Hestia configuration
      const { config } = await loadConfig(this.options.configPath);
      this.hestiaConfig = config;

      // Ensure working directory exists
      await fs.mkdir(this.options.workingDir, { recursive: true });

      // Generate or update OpenClaude profile from Hestia config
      await this.syncProfile();

      // Build environment variables
      const env = await this.buildEnvironment();

      // Build command arguments
      const args = this.buildArguments(startOptions);

      this.logger.info(`Starting OpenClaude with profile: ${this.profilePath}`);
      this.logger.debug(`Command: openclaude ${args.join(" ")}`);

      // Spawn OpenClaude process
      this.process = spawn("openclaude", args, {
        cwd: this.options.workingDir,
        env: { ...process.env, ...env },
        stdio: ["pipe", "pipe", "pipe"],
        detached: false,
      });

      this.startTime = new Date();
      this.status.isRunning = true;
      this.status.pid = this.process.pid;
      this.status.lastStartTime = this.startTime;

      // Setup process event handlers
      this.setupProcessHandlers();

      // Wait for process to be ready
      await this.waitForReady();

      this.logger.success(`OpenClaude started (PID: ${this.process.pid})`);
    } catch (error) {
      this.handleError("Failed to start OpenClaude", error);
      throw error;
    }
  }

  /**
   * Stop OpenClaude process gracefully
   */
  async stop(timeout = 10000): Promise<void> {
    if (!this.process) {
      this.logger.warn("OpenClaude is not running");
      return;
    }

    this.logger.info("Stopping OpenClaude...");

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        // Force kill if graceful shutdown fails
        this.logger.warn("Graceful shutdown timeout, forcing kill...");
        this.process?.kill("SIGKILL");
      }, timeout);

      this.process!.once("exit", (code) => {
        clearTimeout(timer);
        this.cleanupProcess();
        this.logger.success(`OpenClaude stopped (exit code: ${code})`);
        resolve();
      });

      this.process!.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });

      // Try graceful shutdown first
      this.process!.kill("SIGTERM");
    });
  }

  /**
   * Check if OpenClaude is currently running
   */
  isRunning(): boolean {
    return this.status.isRunning && this.process !== null && !this.process.killed;
  }

  /**
   * Get current OpenClaude status
   */
  getStatus(): OpenClaudeStatus {
    if (this.isRunning() && this.startTime) {
      this.status.uptime = Date.now() - this.startTime.getTime();
    }
    return { ...this.status };
  }

  // ==========================================================================
  // Configuration Management
  // ==========================================================================

  /**
   * Configure AI provider (Ollama, OpenRouter, etc.)
   */
  async configureProvider(config: ProviderConfig): Promise<void> {
    this.logger.info(`Configuring provider: ${config.provider}`);

    try {
      // Update Hestia config
      const { config: hestiaConfig, path: configPath } = await loadConfig(this.options.configPath);
      
      hestiaConfig.intelligence = {
        provider: config.provider,
        endpoint: config.endpoint,
        apiKey: config.apiKey,
        model: config.model,
        temperature: config.temperature,
        maxTokens: config.maxTokens,
      };

      await saveConfig(hestiaConfig, configPath);
      this.hestiaConfig = hestiaConfig;

      // Sync to OpenClaude profile
      await this.syncProfile();

      this.logger.success(`Provider configured: ${config.provider} (${config.model})`);

      // Restart if running to apply changes
      if (this.isRunning()) {
        this.logger.info("Restarting OpenClaude to apply provider changes...");
        await this.stop();
        await this.start();
      }
    } catch (error) {
      this.handleError("Failed to configure provider", error);
      throw error;
    }
  }

  /**
   * Get current provider configuration
   */
  async getProviderConfig(): Promise<ProviderConfig | null> {
    try {
      const { config } = await loadConfig(this.options.configPath);
      return config.intelligence || null;
    } catch (error) {
      this.handleError("Failed to get provider config", error);
      return null;
    }
  }

  // ==========================================================================
  // MCP Server Management
  // ==========================================================================

  /**
   * Install an MCP server
   */
  async installMCPServer(name: string, mcpConfig: MCPInstallConfig): Promise<void> {
    this.logger.info(`Installing MCP server: ${name}`);

    try {
      const profile = await this.loadProfile();

      // Create MCP server entry
      const server: MCPInstalledServer = {
        name,
        enabled: true,
        command: mcpConfig.command,
        args: mcpConfig.args || [],
        transport: mcpConfig.url ? "sse" : "stdio",
      };

      // Add environment variables to profile if provided
      if (mcpConfig.env) {
        const envPath = path.join(this.options.workingDir, `.mcp-${name}.env`);
        const envContent = Object.entries(mcpConfig.env)
          .map(([key, value]) => `${key}=${value}`)
          .join("\n");
        await fs.writeFile(envPath, envContent, "utf-8");
        this.logger.debug(`MCP server env written to: ${envPath}`);
      }

      // Update profile
      profile.mcpServers = profile.mcpServers || {};
      profile.mcpServers[name] = server;

      await this.saveProfile(profile);

      this.logger.success(`MCP server installed: ${name}`);

      // Restart if running to load new MCP server
      if (this.isRunning()) {
        this.logger.info("Restarting OpenClaude to load MCP server...");
        await this.stop();
        await this.start();
      }
    } catch (error) {
      this.handleError(`Failed to install MCP server: ${name}`, error);
      throw error;
    }
  }

  /**
   * List installed MCP servers
   */
  async listMCPServers(): Promise<MCPInstalledServer[]> {
    try {
      const profile = await this.loadProfile();
      return Object.values(profile.mcpServers || {});
    } catch (error) {
      this.handleError("Failed to list MCP servers", error);
      return [];
    }
  }

  /**
   * Uninstall an MCP server
   */
  async uninstallMCPServer(name: string): Promise<void> {
    this.logger.info(`Uninstalling MCP server: ${name}`);

    try {
      const profile = await this.loadProfile();

      if (!profile.mcpServers?.[name]) {
        throw new Error(`MCP server not found: ${name}`);
      }

      delete profile.mcpServers[name];
      await this.saveProfile(profile);

      // Clean up env file if exists
      const envPath = path.join(this.options.workingDir, `.mcp-${name}.env`);
      try {
        await fs.unlink(envPath);
      } catch {
        // Ignore if file doesn't exist
      }

      this.logger.success(`MCP server uninstalled: ${name}`);

      // Restart if running
      if (this.isRunning()) {
        await this.stop();
        await this.start();
      }
    } catch (error) {
      this.handleError(`Failed to uninstall MCP server: ${name}`, error);
      throw error;
    }
  }

  /**
   * Enable/disable an MCP server
   */
  async toggleMCPServer(name: string, enabled: boolean): Promise<void> {
    this.logger.info(`${enabled ? "Enabling" : "Disabling"} MCP server: ${name}`);

    try {
      const profile = await this.loadProfile();

      if (!profile.mcpServers?.[name]) {
        throw new Error(`MCP server not found: ${name}`);
      }

      profile.mcpServers[name].enabled = enabled;
      await this.saveProfile(profile);

      this.logger.success(`MCP server ${enabled ? "enabled" : "disabled"}: ${name}`);

      // Restart if running
      if (this.isRunning()) {
        await this.stop();
        await this.start();
      }
    } catch (error) {
      this.handleError(`Failed to toggle MCP server: ${name}`, error);
      throw error;
    }
  }

  // ==========================================================================
  // Command Execution
  // ==========================================================================

  /**
   * Execute a command via OpenClaude
   */
  async executeCommand(command: string, timeout = 60000): Promise<ExecuteResult> {
    if (!this.isRunning()) {
      return {
        success: false,
        error: "OpenClaude is not running",
        exitCode: -1,
      };
    }

    this.logger.debug(`Executing command: ${command}`);

    return new Promise((resolve) => {
      const chunks: string[] = [];
      const timeoutId = setTimeout(() => {
        resolve({
          success: false,
          error: "Command execution timeout",
          exitCode: -1,
        });
      }, timeout);

      // Write command to stdin
      this.process!.stdin?.write(command + "\n");

      // Collect output
      const onData = (data: Buffer) => {
        chunks.push(data.toString());
      };

      this.process!.stdout?.on("data", onData);

      // Wait for completion (this is simplified - real implementation would
      // need a protocol for detecting command completion)
      setTimeout(() => {
        clearTimeout(timeoutId);
        this.process!.stdout?.off("data", onData);

        resolve({
          success: true,
          output: chunks.join(""),
          exitCode: 0,
        });
      }, 5000);
    });
  }

  // ==========================================================================
  // Hestia Integration
  // ==========================================================================

  /**
   * Enable Hestia integration - exposes Hestia tools as MCP servers
   */
  async enableHestiaIntegration(options: {
    backendUrl?: string;
    apiKey?: string;
    workspaceId?: string;
  } = {}): Promise<void> {
    this.logger.info("Enabling Hestia integration...");

    try {
      const { config } = await loadConfig(this.options.configPath);
      const credentials = await loadCredentials();

      const backendUrl = options.backendUrl || config.connectors?.controlPlane?.url || "http://localhost:4000";
      const apiKey = options.apiKey || credentials.SYNAP_API_KEY || credentials.HESTIA_API_KEY;
      const workspaceId = options.workspaceId || process.env.HESTIA_WORKSPACE_ID;

      // Update profile with Hestia integration
      const profile = await this.loadProfile();
      profile.hestiaIntegration = {
        enabled: true,
        backendUrl,
        apiKey,
        workspaceId,
      };

      // Install Hestia MCP server if not already installed
      if (!profile.mcpServers?.["hestia"]) {
        profile.mcpServers = profile.mcpServers || {};
        profile.mcpServers["hestia"] = {
          name: "hestia",
          enabled: true,
          command: "npx",
          args: ["-y", "@synap/mcp-hearth", "start"],
          transport: "stdio",
        };
      }

      await this.saveProfile(profile);

      // Set environment variables for the MCP server
      const envPath = path.join(this.options.workingDir, ".mcp-hestia.env");
      const envContent = [
        `SYNAP_BACKEND_URL=${backendUrl}`,
        `SYNAP_API_KEY=${apiKey || ""}`,
        `HESTIA_WORKSPACE_ID=${workspaceId || ""}`,
      ].join("\n");
      await fs.writeFile(envPath, envContent, "utf-8");

      this.logger.success("Hestia integration enabled");
      this.logger.info(`Backend: ${backendUrl}`);
      this.logger.info(`Workspace: ${workspaceId || "default"}`);

      // Restart if running
      if (this.isRunning()) {
        await this.stop();
        await this.start();
      }
    } catch (error) {
      this.handleError("Failed to enable Hestia integration", error);
      throw error;
    }
  }

  /**
   * Log activity to Hestia
   */
  async logActivity(type: string, details: Record<string, unknown>): Promise<void> {
    this.logger.debug(`Logging activity: ${type}`, details);

    // This would integrate with Hestia's logging/audit system
    // For now, just log locally
    const logEntry = {
      timestamp: new Date().toISOString(),
      type,
      details,
      source: "openclaude",
    };

    const logPath = path.join(this.options.workingDir, "activity.log");
    const logLine = JSON.stringify(logEntry) + "\n";

    try {
      await fs.appendFile(logPath, logLine, "utf-8");
    } catch (error) {
      this.logger.warn("Failed to write activity log", { error });
    }
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  private async syncProfile(): Promise<void> {
    const profile = await this.loadProfile();
    const hestiaConfig = this.hestiaConfig || (await loadConfig(this.options.configPath)).config;

    // Map Hestia intelligence config to OpenClaude profile
    if (hestiaConfig.intelligence) {
      const intelligence = hestiaConfig.intelligence;

      profile.provider = this.mapProvider(intelligence.provider);
      profile.model = intelligence.model;
      profile.endpoint = intelligence.endpoint;
      profile.apiKey = intelligence.apiKey;
      profile.temperature = intelligence.temperature;
      profile.maxTokens = intelligence.maxTokens;
    }

    // Add version and name
    profile.version = profile.version || "1.0";
    profile.name = profile.name || "Hestia Profile";

    await this.saveProfile(profile);

    this.status.profileLoaded = this.profilePath;
    this.status.currentProvider = profile.provider;

    this.logger.debug(`Profile synced: ${this.profilePath}`);
  }

  private mapProvider(provider: IntelligenceConfig["provider"]): string {
    // Map Hestia provider names to OpenClaude provider names
    const providerMap: Record<string, string> = {
      ollama: "ollama",
      openrouter: "openrouter",
      anthropic: "anthropic",
      openai: "openai",
      custom: "custom",
    };

    return providerMap[provider] || provider;
  }

  private async loadProfile(): Promise<OpenClaudeProfile> {
    try {
      const content = await fs.readFile(this.profilePath, "utf-8");
      return JSON.parse(content) as OpenClaudeProfile;
    } catch (error) {
      // Return default profile if file doesn't exist or is invalid
      return {
        version: "1.0",
        name: "Hestia Default Profile",
        provider: "ollama",
        model: "llama3.1:8b",
        mcpServers: {},
      };
    }
  }

  private async saveProfile(profile: OpenClaudeProfile): Promise<void> {
    await fs.writeFile(this.profilePath, JSON.stringify(profile, null, 2), "utf-8");
  }

  private async buildEnvironment(): Promise<Record<string, string>> {
    const env: Record<string, string> = {
      // OpenClaude profile path
      OPENCLAUDE_PROFILE: this.profilePath,
    };

    // Add API keys based on provider
    const { config } = await loadConfig(this.options.configPath);
    const credentials = await loadCredentials();

    if (config.intelligence?.apiKey) {
      // Map to appropriate env var based on provider
      switch (config.intelligence.provider) {
        case "openai":
          env.OPENAI_API_KEY = config.intelligence.apiKey;
          break;
        case "anthropic":
          env.ANTHROPIC_API_KEY = config.intelligence.apiKey;
          break;
        case "openrouter":
          env.OPENROUTER_API_KEY = config.intelligence.apiKey;
          break;
        case "ollama":
          // Ollama typically doesn't need API key
          break;
      }
    }

    // Add Synap Backend credentials for Hestia integration
    if (credentials.SYNAP_API_KEY) {
      env.SYNAP_API_KEY = credentials.SYNAP_API_KEY;
    }
    if (credentials.HESTIA_API_KEY) {
      env.HESTIA_API_KEY = credentials.HESTIA_API_KEY;
    }

    // Add Hestia config
    if (config.connectors?.controlPlane?.url) {
      env.HESTIA_POD_URL = config.connectors.controlPlane.url;
    }

    return env;
  }

  private buildArguments(options?: { profile?: string; command?: string }): string[] {
    const args: string[] = [];

    // Use profile path
    args.push("--profile", options?.profile || this.profilePath);

    // Add any additional command
    if (options?.command) {
      args.push(options.command);
    }

    return args;
  }

  private setupProcessHandlers(): void {
    if (!this.process) return;

    // Handle stdout
    this.process.stdout?.on("data", (data: Buffer) => {
      const output = data.toString().trim();
      this.logger.debug(`[OpenClaude stdout] ${output}`);
    });

    // Handle stderr
    this.process.stderr?.on("data", (data: Buffer) => {
      const error = data.toString().trim();
      this.logger.warn(`[OpenClaude stderr] ${error}`);
      this.status.errors.push(error);

      // Keep only last 10 errors
      if (this.status.errors.length > 10) {
        this.status.errors.shift();
      }
    });

    // Handle exit
    this.process.on("exit", (code, signal) => {
      this.logger.info(`OpenClaude exited (code: ${code}, signal: ${signal})`);
      this.cleanupProcess();

      // Auto-restart if enabled and not intentionally stopped
      if (this.options.autoRestart && code !== 0 && signal !== "SIGTERM") {
        this.handleCrash();
      }
    });

    // Handle errors
    this.process.on("error", (error) => {
      this.handleError("Process error", error);
    });
  }

  private cleanupProcess(): void {
    this.status.isRunning = false;
    this.status.pid = undefined;
    this.process = null;
  }

  private async handleCrash(): Promise<void> {
    if (this.restartAttempts >= this.options.maxRestarts) {
      this.logger.error(`Max restarts (${this.options.maxRestarts}) reached. Giving up.`);
      return;
    }

    this.restartAttempts++;
    this.status.restartCount = this.restartAttempts;

    const delay = Math.min(1000 * Math.pow(2, this.restartAttempts - 1), 30000); // Exponential backoff, max 30s
    this.logger.info(`Auto-restarting in ${delay}ms (attempt ${this.restartAttempts}/${this.options.maxRestarts})...`);

    setTimeout(async () => {
      try {
        await this.start();
        this.restartAttempts = 0; // Reset on successful start
      } catch (error) {
        this.handleError("Auto-restart failed", error);
      }
    }, delay);
  }

  private async waitForReady(timeout = 30000): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`OpenClaude failed to start within ${timeout}ms`));
      }, timeout);

      // Monitor stdout for ready signal
      const onData = (data: Buffer) => {
        const output = data.toString().toLowerCase();
        // Common ready signals from OpenClaude
        if (
          output.includes("ready") ||
          output.includes("listening") ||
          output.includes("started") ||
          output.includes("🚀")
        ) {
          clearTimeout(timer);
          this.process!.stdout?.off("data", onData);
          resolve();
        }
      };

      this.process!.stdout?.on("data", onData);

      // Also resolve after a minimum time if no clear ready signal
      setTimeout(() => {
        clearTimeout(timer);
        this.process!.stdout?.off("data", onData);
        resolve();
      }, 5000);
    });
  }

  private handleError(message: string, error: unknown): void {
    const errorMessage = error instanceof Error ? error.message : String(error);
    this.logger.error(`${message}: ${errorMessage}`);
    this.status.errors.push(`${message}: ${errorMessage}`);

    if (this.status.errors.length > 10) {
      this.status.errors.shift();
    }
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

export const openclaudeService = new OpenClaudeService();
