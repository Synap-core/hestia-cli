/**
 * OpenClaw Integration Service
 *
 * Manages OpenClaw AI assistant integration for Hestia.
 * Handles installation, configuration, skill management, and communication platforms.
 *
 * OpenClaw is a stateful AI assistant framework that can be installed via npm (when published)
 * or git clone (for development/latest versions).
 */

import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { spawn, ChildProcess, exec } from "child_process";
import { promisify } from "util";
import * as YAML from "yaml";
import { z } from "zod";
import { logger } from '../../../utils/index.js';
import type { HestiaConfig, IntelligenceConfig } from '../../../lib/types/index.js';
import { loadConfig, getConfigPaths, saveConfig } from '../../../utils/index.js';

const execAsync = promisify(exec);

// ============================================================================
// TYPES
// ============================================================================

export type OpenClawInstallMethod = "npm" | "git";
export type OpenClawStatus = "not_installed" | "installing" | "installed" | "starting" | "running" | "stopping" | "stopped" | "error";
export type CommsPlatform = "telegram" | "whatsapp" | "discord" | "imessage";
export type SkillLanguage = "typescript" | "python" | "javascript";

export interface OpenClawConfig {
  version: string;
  installMethod: OpenClawInstallMethod;
  installPath: string;
  port: number;
  apiPort: number;
  intelligence: IntelligenceConfig;
  comms: Partial<Record<CommsPlatform, CommsPlatformConfig>>;
  skills: SkillMetadata[];
  hotReload: boolean;
  logLevel: "debug" | "info" | "warn" | "error";
  features: {
    proactiveMessages: boolean;
    memoryEnabled: boolean;
    toolsEnabled: boolean;
    webSearch: boolean;
  };
}

export interface CommsPlatformConfig {
  enabled: boolean;
  botToken?: string;
  apiKey?: string;
  webhookUrl?: string;
  phoneNumber?: string; // For WhatsApp
  channelId?: string; // For Discord
  allowedUsers?: string[];
  autoReply: boolean;
}

export interface SkillMetadata {
  name: string;
  version: string;
  description: string;
  language: SkillLanguage;
  author?: string;
  tags: string[];
  entryPoint: string;
  configSchema?: Record<string, unknown>;
  enabled: boolean;
  installedAt: Date;
  lastUpdated: Date;
}

export interface SkillCode {
  metadata: SkillMetadata;
  code: string;
  config?: Record<string, unknown>;
}

export interface OpenClawActivity {
  id: string;
  timestamp: Date;
  type: "message" | "skill_call" | "tool_use" | "error" | "system";
  platform?: CommsPlatform;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface OpenClawStatusInfo {
  status: OpenClawStatus;
  version?: string;
  pid?: number;
  uptime?: number;
  port: number;
  apiPort: number;
  lastError?: string;
  comms: Partial<Record<CommsPlatform, { connected: boolean; lastActivity?: Date }>>;
  stats: {
    messagesReceived: number;
    messagesSent: number;
    skillsCalled: number;
    errors: number;
  };
}

export interface StartOptions {
  port?: number;
  apiPort?: number;
  foreground?: boolean;
  debug?: boolean;
}

// ============================================================================
// CONFIGURATION SCHEMAS
// ============================================================================

const commsPlatformConfigSchema = z.object({
  enabled: z.boolean(),
  botToken: z.string().optional(),
  apiKey: z.string().optional(),
  webhookUrl: z.string().url().optional(),
  phoneNumber: z.string().optional(),
  channelId: z.string().optional(),
  allowedUsers: z.array(z.string()).optional(),
  autoReply: z.boolean().default(true),
});

const skillMetadataSchema = z.object({
  name: z.string(),
  version: z.string(),
  description: z.string(),
  language: z.enum(["typescript", "python", "javascript"]),
  author: z.string().optional(),
  tags: z.array(z.string()).default([]),
  entryPoint: z.string(),
  configSchema: z.record(z.unknown()).optional(),
  enabled: z.boolean().default(true),
  installedAt: z.date().or(z.string().transform((s) => new Date(s))),
  lastUpdated: z.date().or(z.string().transform((s) => new Date(s))),
});

const openClawConfigSchema = z.object({
  version: z.string().default("0.1.0"),
  installMethod: z.enum(["npm", "git"]).default("git"),
  installPath: z.string(),
  port: z.number().default(3001),
  apiPort: z.number().default(3002),
  intelligence: z.object({
    provider: z.enum(["ollama", "openrouter", "anthropic", "openai", "custom"]),
    endpoint: z.string().url().optional(),
    apiKey: z.string().optional(),
    model: z.string(),
    temperature: z.number().min(0).max(2).optional(),
    maxTokens: z.number().optional(),
  }),
  comms: z.record(commsPlatformConfigSchema).default({}),
  skills: z.array(skillMetadataSchema).default([]),
  hotReload: z.boolean().default(true),
  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
  features: z.object({
    proactiveMessages: z.boolean().default(true),
    memoryEnabled: z.boolean().default(true),
    toolsEnabled: z.boolean().default(true),
    webSearch: z.boolean().default(false),
  }).default({}),
});

// ============================================================================
// OPENCLAW SERVICE
// ============================================================================

export class OpenClawService {
  private process: ChildProcess | null = null;
  private status: OpenClawStatus = "not_installed";
  private openClawDir: string;
  private configPath: string;
  private skillsDir: string;
  private activityLog: OpenClawActivity[] = [];
  private stats = {
    messagesReceived: 0,
    messagesSent: 0,
    skillsCalled: 0,
    errors: 0,
  };
  private statusCheckInterval: NodeJS.Timeout | null = null;

  constructor() {
    // OpenClaw lives in ~/.openclaw/
    this.openClawDir = path.join(os.homedir(), ".openclaw");
    this.configPath = path.join(this.openClawDir, "config.yaml");
    this.skillsDir = path.join(this.openClawDir, "skills");
  }

  // ==========================================================================
  // INSTALLATION
  // ==========================================================================

  /**
   * Install OpenClaw. Tries npm first, falls back to git clone.
   * @param options - Installation options
   * @returns The install method used
   */
  async install(options?: {
    version?: string;
    method?: OpenClawInstallMethod;
    npmPackage?: string;
    gitUrl?: string;
  }): Promise<OpenClawInstallMethod> {
    const method = options?.method;
    const version = options?.version || "latest";

    logger.info("Installing OpenClaw...");
    this.status = "installing";

    try {
      // Ensure directory exists
      await fs.mkdir(this.openClawDir, { recursive: true });
      await fs.mkdir(this.skillsDir, { recursive: true });

      // Try npm first if not explicitly requesting git
      if (!method || method === "npm") {
        try {
          logger.info("Attempting npm installation...");
          await this.installViaNpm(options?.npmPackage || "@openclaw/core", version);
          logger.success("OpenClaw installed via npm");
          this.status = "installed";
          return "npm";
        } catch (npmError) {
          logger.warn(`npm install failed: ${npmError instanceof Error ? npmError.message : "Unknown error"}`);
          if (method === "npm") {
            throw npmError; // User explicitly wanted npm
          }
          logger.info("Falling back to git clone...");
        }
      }

      // Fall back to git clone
      await this.installViaGit(options?.gitUrl || "https://github.com/openclaw/core.git");
      logger.success("OpenClaw installed via git");
      this.status = "installed";
      return "git";
    } catch (error) {
      this.status = "error";
      logger.error(`Failed to install OpenClaw: ${error instanceof Error ? error.message : "Unknown error"}`);
      throw error;
    }
  }

  private async installViaNpm(packageName: string, version: string): Promise<void> {
    const installPath = path.join(this.openClawDir, "core");

    // Create a temporary package.json for npm install
    await fs.mkdir(installPath, { recursive: true });

    const npmSpec = version === "latest" ? packageName : `${packageName}@${version}`;

    try {
      // Try global install first
      await execAsync(`npm install -g ${npmSpec}`, { timeout: 120000 });
      logger.info(`Installed ${npmSpec} globally`);
    } catch {
      // Fall back to local install
      logger.info("Global install failed, installing locally...");
      await execAsync(`npm install ${npmSpec}`, {
        cwd: installPath,
        timeout: 120000,
      });
    }

    // Create initial config
    await this.createDefaultConfig("npm", installPath);
  }

  private async installViaGit(repoUrl: string): Promise<void> {
    const installPath = path.join(this.openClawDir, "core");

    // Remove existing directory if present
    try {
      await fs.rm(installPath, { recursive: true, force: true });
    } catch {
      // Directory might not exist
    }

    // Clone repository
    await execAsync(`git clone --depth 1 ${repoUrl} ${installPath}`, {
      timeout: 120000,
    });

    logger.info("Git clone complete, installing dependencies...");

    // Install dependencies
    await execAsync("npm install", {
      cwd: installPath,
      timeout: 300000,
    });

    // Build if necessary
    try {
      await execAsync("npm run build", {
        cwd: installPath,
        timeout: 120000,
      });
    } catch {
      // Build script might not exist, skip
      logger.debug("No build script or build failed, continuing...");
    }

    // Create initial config
    await this.createDefaultConfig("git", installPath);
  }

  private async createDefaultConfig(
    installMethod: OpenClawInstallMethod,
    installPath: string
  ): Promise<void> {
    const { config: hestiaConfig } = await loadConfig();

    const openClawConfig: OpenClawConfig = {
      version: "0.1.0",
      installMethod,
      installPath,
      port: 3001,
      apiPort: 3002,
      intelligence: hestiaConfig.intelligence || {
        provider: "ollama",
        endpoint: "http://localhost:11434",
        model: "llama3.1:8b",
      },
      comms: {},
      skills: [],
      hotReload: true,
      logLevel: "info",
      features: {
        proactiveMessages: true,
        memoryEnabled: true,
        toolsEnabled: true,
        webSearch: false,
      },
    };

    await this.saveOpenClawConfig(openClawConfig);
  }

  // ==========================================================================
  // LIFECYCLE MANAGEMENT
  // ==========================================================================

  /**
   * Start the OpenClaw service
   * @param options - Start options
   */
  async start(options: StartOptions = {}): Promise<void> {
    if (this.process) {
      logger.warn("OpenClaw is already running");
      return;
    }

    if (!(await this.isInstalled())) {
      throw new Error("OpenClaw is not installed. Run install() first.");
    }

    const config = await this.loadOpenClawConfig();
    const port = options.port || config.port;
    const apiPort = options.apiPort || config.apiPort;

    logger.info(`Starting OpenClaw on port ${port} (API: ${apiPort})...`);
    this.status = "starting";

    try {
      // Check if already running via port check
      const isPortInUse = await this.checkPortInUse(port);
      if (isPortInUse) {
        throw new Error(`Port ${port} is already in use. Another OpenClaw instance may be running.`);
      }

      // Prepare environment
      const env = this.prepareEnvironment(config);

      // Determine how to start based on install method
      let startCommand: string;
      let startArgs: string[];
      let cwd: string;

      if (config.installMethod === "npm") {
        // Try global binary first
        startCommand = "openclaw";
        startArgs = ["start", "--port", String(port), "--api-port", String(apiPort)];
        cwd = process.cwd();

        // Check if global binary exists
        try {
          await execAsync("which openclaw");
        } catch {
          // Fall back to local
          startCommand = "npx";
          startArgs = ["openclaw", "start", "--port", String(port), "--api-port", String(apiPort)];
          cwd = config.installPath;
        }
      } else {
        // Git install - use npm start
        startCommand = "npm";
        startArgs = ["start", "--", "--port", String(port), "--api-port", String(apiPort)];
        cwd = config.installPath;
      }

      // Spawn process
      this.process = spawn(startCommand, startArgs, {
        cwd,
        env: { ...process.env, ...env },
        detached: !options.foreground,
        stdio: options.debug ? "inherit" : ["ignore", "pipe", "pipe"],
      });

      // Set up event handlers
      this.setupProcessHandlers(this.process, config);

      // Wait for startup
      await this.waitForStartup(port, 30000);

      this.status = "running";
      logger.success(`OpenClaw started on port ${port}`);

      // Start status checking
      this.startStatusCheck(config);

      // If not in foreground mode, unref so parent can exit
      if (!options.foreground && this.process) {
        this.process.unref();
      }
    } catch (error) {
      this.status = "error";
      this.process = null;
      logger.error(`Failed to start OpenClaw: ${error instanceof Error ? error.message : "Unknown error"}`);
      throw error;
    }
  }

  /**
   * Stop the OpenClaw service
   */
  async stop(): Promise<void> {
    if (!this.process) {
      // Try to find and kill any running OpenClaw processes
      logger.info("Looking for OpenClaw processes...");
      try {
        await execAsync("pkill -f 'openclaw' || true");
        logger.success("OpenClaw processes terminated");
      } catch {
        logger.warn("No OpenClaw processes found");
      }
      this.status = "stopped";
      return;
    }

    logger.info("Stopping OpenClaw...");
    this.status = "stopping";

    // Stop status check interval
    if (this.statusCheckInterval) {
      clearInterval(this.statusCheckInterval);
      this.statusCheckInterval = null;
    }

    // Try graceful shutdown first
    this.process.kill("SIGTERM");

    // Wait for process to exit
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        // Force kill if not exited
        if (this.process) {
          this.process.kill("SIGKILL");
        }
        resolve();
      }, 5000);

      if (this.process) {
        this.process.on("exit", () => {
          clearTimeout(timeout);
          resolve();
        });
      } else {
        resolve();
      }
    });

    this.process = null;
    this.status = "stopped";
    logger.success("OpenClaw stopped");
  }

  /**
   * Check if OpenClaw is currently running
   */
  async isRunning(): Promise<boolean> {
    if (this.process && !this.process.killed) {
      return true;
    }

    // Check if another instance is running on the port
    try {
      const config = await this.loadOpenClawConfig();
      const isPortInUse = await this.checkPortInUse(config.port);
      if (isPortInUse) {
        this.status = "running";
        return true;
      }
    } catch {
      // Config might not exist
    }

    return false;
  }

  /**
   * Check if OpenClaw is installed
   */
  async isInstalled(): Promise<boolean> {
    try {
      await fs.access(this.configPath);
      const config = await this.loadOpenClawConfig();
      await fs.access(config.installPath);
      return true;
    } catch {
      return false;
    }
  }

  // ==========================================================================
  // CONFIGURATION MANAGEMENT
  // ==========================================================================

  /**
   * Get current OpenClaw configuration
   */
  async getConfig(): Promise<OpenClawConfig> {
    return this.loadOpenClawConfig();
  }

  /**
   * Update OpenClaw configuration
   * @param config - Partial configuration to merge
   */
  async configure(config: Partial<OpenClawConfig>): Promise<OpenClawConfig> {
    const currentConfig = await this.loadOpenClawConfig();
    const mergedConfig = { ...currentConfig, ...config };

    // Deep merge for nested objects
    if (config.comms) {
      mergedConfig.comms = { ...currentConfig.comms, ...config.comms };
    }
    if (config.features) {
      mergedConfig.features = { ...currentConfig.features, ...config.features };
    }

    // Validate
    const validated = openClawConfigSchema.parse(mergedConfig);

    await this.saveOpenClawConfig(validated as OpenClawConfig);
    logger.success("OpenClaw configuration updated");

    // If running, notify about config change
    if (await this.isRunning()) {
      logger.info("OpenClaw is running - hot-reloading configuration...");
      await this.notifyConfigChange();
    }

    return validated as OpenClawConfig;
  }

  /**
   * Synchronize Hestia config with OpenClaw config
   * Translates Hestia intelligence settings to OpenClaw format
   */
  async syncWithHestia(): Promise<void> {
    const { config: hestiaConfig } = await loadConfig();
    const openClawConfig = await this.loadOpenClawConfig();

    // Update intelligence settings from Hestia
    if (hestiaConfig.intelligence) {
      openClawConfig.intelligence = hestiaConfig.intelligence;
    }

    await this.saveOpenClawConfig(openClawConfig);
    logger.debug("Synchronized OpenClaw config with Hestia");
  }

  // ==========================================================================
  // SKILL MANAGEMENT
  // ==========================================================================

  /**
   * Add a new skill to OpenClaw
   * @param name - Skill name (unique identifier)
   * @param code - Skill code and metadata
   */
  async addSkill(name: string, code: SkillCode): Promise<SkillMetadata> {
    const config = await this.loadOpenClawConfig();

    // Check for duplicate
    if (config.skills.some((s) => s.name === name)) {
      throw new Error(`Skill '${name}' already exists. Use updateSkill() to modify.`);
    }

    const skillDir = path.join(this.skillsDir, name);
    await fs.mkdir(skillDir, { recursive: true });

    // Write skill code
    const extension = this.getFileExtension(code.metadata.language);
    const entryPoint = `index.${extension}`;
    const codePath = path.join(skillDir, entryPoint);

    await fs.writeFile(codePath, code.code, "utf-8");

    // Write metadata
    const metadata: SkillMetadata = {
      ...code.metadata,
      name,
      entryPoint,
      installedAt: new Date(),
      lastUpdated: new Date(),
    };

    await fs.writeFile(
      path.join(skillDir, "meta.yaml"),
      YAML.dump(metadata),
      "utf-8"
    );

    // Write config if provided
    if (code.config) {
      await fs.writeFile(
        path.join(skillDir, "config.yaml"),
        YAML.dump(code.config),
        "utf-8"
      );
    }

    // Update config
    config.skills.push(metadata);
    await this.saveOpenClawConfig(config);

    // Hot reload if running
    if (config.hotReload && (await this.isRunning())) {
      await this.reloadSkills();
    }

    logger.success(`Skill '${name}' added`);
    return metadata;
  }

  /**
   * Remove a skill from OpenClaw
   * @param name - Skill name to remove
   */
  async removeSkill(name: string): Promise<void> {
    const config = await this.loadOpenClawConfig();

    const skillIndex = config.skills.findIndex((s) => s.name === name);
    if (skillIndex === -1) {
      throw new Error(`Skill '${name}' not found`);
    }

    // Remove skill directory
    const skillDir = path.join(this.skillsDir, name);
    await fs.rm(skillDir, { recursive: true, force: true });

    // Update config
    config.skills.splice(skillIndex, 1);
    await this.saveOpenClawConfig(config);

    // Hot reload if running
    if (config.hotReload && (await this.isRunning())) {
      await this.reloadSkills();
    }

    logger.success(`Skill '${name}' removed`);
  }

  /**
   * List all installed skills
   */
  async listSkills(): Promise<SkillMetadata[]> {
    const config = await this.loadOpenClawConfig();
    return config.skills;
  }

  /**
   * Get skill code
   * @param name - Skill name
   */
  async getSkill(name: string): Promise<SkillCode | null> {
    const config = await this.loadOpenClawConfig();
    const metadata = config.skills.find((s) => s.name === name);

    if (!metadata) {
      return null;
    }

    const skillDir = path.join(this.skillsDir, name);
    const codePath = path.join(skillDir, metadata.entryPoint);

    try {
      const code = await fs.readFile(codePath, "utf-8");

      // Load config if exists
      let skillConfig: Record<string, unknown> | undefined;
      try {
        const configContent = await fs.readFile(
          path.join(skillDir, "config.yaml"),
          "utf-8"
        );
        skillConfig = YAML.load(configContent);
      } catch {
        // No config file
      }

      return { metadata, code, config: skillConfig };
    } catch {
      return null;
    }
  }

  /**
   * Update an existing skill
   * @param name - Skill name
   * @param updates - Partial updates
   */
  async updateSkill(
    name: string,
    updates: Partial<Pick<SkillCode, "code" | "metadata" | "config">>
  ): Promise<SkillMetadata> {
    const config = await this.loadOpenClawConfig();
    const skillIndex = config.skills.findIndex((s) => s.name === name);

    if (skillIndex === -1) {
      throw new Error(`Skill '${name}' not found`);
    }

    const skillDir = path.join(this.skillsDir, name);
    const currentMetadata = config.skills[skillIndex];

    // Update code if provided
    if (updates.code) {
      const codePath = path.join(skillDir, currentMetadata.entryPoint);
      await fs.writeFile(codePath, updates.code, "utf-8");
    }

    // Update metadata if provided
    let newMetadata = currentMetadata;
    if (updates.metadata) {
      newMetadata = {
        ...currentMetadata,
        ...updates.metadata,
        name, // Ensure name doesn't change
        lastUpdated: new Date(),
      };
      await fs.writeFile(
        path.join(skillDir, "meta.yaml"),
        YAML.dump(newMetadata),
        "utf-8"
      );
    }

    // Update config if provided
    if (updates.config) {
      await fs.writeFile(
        path.join(skillDir, "config.yaml"),
        YAML.dump(updates.config),
        "utf-8"
      );
    }

    // Update config list
    config.skills[skillIndex] = newMetadata;
    await this.saveOpenClawConfig(config);

    // Hot reload if running
    if (config.hotReload && (await this.isRunning())) {
      await this.reloadSkills();
    }

    logger.success(`Skill '${name}' updated`);
    return newMetadata;
  }

  /**
   * Enable or disable a skill
   * @param name - Skill name
   * @param enabled - Enable status
   */
  async toggleSkill(name: string, enabled: boolean): Promise<SkillMetadata> {
    const config = await this.loadOpenClawConfig();
    const skillIndex = config.skills.findIndex((s) => s.name === name);

    if (skillIndex === -1) {
      throw new Error(`Skill '${name}' not found`);
    }

    // Update the skill in config
    config.skills[skillIndex] = {
      ...config.skills[skillIndex],
      enabled,
      lastUpdated: new Date(),
    };

    await this.saveOpenClawConfig(config);

    // Update the metadata file
    const skillDir = path.join(this.skillsDir, name);
    await fs.writeFile(
      path.join(skillDir, "meta.yaml"),
      YAML.dump(config.skills[skillIndex]),
      "utf-8"
    );

    // Hot reload if running
    if (config.hotReload && (await this.isRunning())) {
      await this.reloadSkills();
    }

    logger.success(`Skill '${name}' ${enabled ? 'enabled' : 'disabled'}`);
    return config.skills[skillIndex];
  }

  // ==========================================================================
  // COMMUNICATIONS PLATFORM SETUP
  // ==========================================================================

  /**
   * Configure a communication platform (Telegram, WhatsApp, Discord, iMessage)
   * @param platform - Platform to configure
   * @param config - Platform configuration
   */
  async configureComms(
    platform: CommsPlatform,
    config: Partial<CommsPlatformConfig>
  ): Promise<void> {
    const openClawConfig = await this.loadOpenClawConfig();

    // Merge with existing config
    const existingConfig = openClawConfig.comms[platform] || {
      enabled: false,
      autoReply: true,
    };

    openClawConfig.comms[platform] = {
      ...existingConfig,
      ...config,
      enabled: config.enabled ?? existingConfig.enabled,
    };

    await this.saveOpenClawConfig(openClawConfig);
    logger.success(`${platform} configuration updated`);

    // If running, notify about config change
    if (await this.isRunning()) {
      await this.notifyConfigChange();
    }
  }

  /**
   * Get communication platform status
   */
  async getCommsStatus(): Promise<Record<CommsPlatform, { enabled: boolean; connected: boolean }>> {
    const config = await this.loadOpenClawConfig();
    const status = {} as Record<CommsPlatform, { enabled: boolean; connected: boolean }>;

    // Check actual connection status via API if running
    let apiStatus: Partial<Record<CommsPlatform, boolean>> = {};
    if (await this.isRunning()) {
      try {
        apiStatus = await this.fetchCommsStatusFromAPI();
      } catch (error) {
        logger.debug("Could not fetch comms status from API:", error);
      }
    }

    for (const platform of ["telegram", "whatsapp", "discord", "imessage"] as CommsPlatform[]) {
      const platformConfig = config.comms[platform];
      status[platform] = {
        enabled: platformConfig?.enabled ?? false,
        connected: apiStatus[platform] ?? false,
      };
    }

    return status;
  }

  /**
   * Test a communication platform connection
   * @param platform - Platform to test
   */
  async testCommsConnection(platform: CommsPlatform): Promise<{ success: boolean; message: string }> {
    const config = await this.loadOpenClawConfig();
    const platformConfig = config.comms[platform];

    if (!platformConfig?.enabled) {
      return { success: false, message: `${platform} is not enabled` };
    }

    // Send test request to OpenClaw API
    // NOTE: This is a placeholder for the actual OpenClaw API call
    try {
      const response = await this.callOpenClawAPI("/comms/test", {
        method: "POST",
        body: JSON.stringify({ platform }),
      });

      return response as { success: boolean; message: string };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : "Connection test failed",
      };
    }
  }

  // ==========================================================================
  // MESSAGING
  // ==========================================================================

  /**
   * Send a message to the OpenClaw assistant
   * @param message - Message content
   * @param options - Message options
   * @returns The assistant's response
   */
  async sendMessage(
    message: string,
    options?: {
      platform?: CommsPlatform;
      userId?: string;
      chatId?: string;
      context?: Record<string, unknown>;
    }
  ): Promise<{ response: string; metadata?: Record<string, unknown> }> {
    if (!(await this.isRunning())) {
      throw new Error("OpenClaw is not running. Start it first.");
    }

    // Record activity
    this.recordActivity({
      type: "message",
      platform: options?.platform,
      content: message,
      metadata: options?.context,
    });

    // Send to OpenClaw API
    // NOTE: This is a placeholder for the actual OpenClaw API call
    try {
      const response = await this.callOpenClawAPI("/chat/completions", {
        method: "POST",
        body: JSON.stringify({
          message,
          user_id: options?.userId,
          chat_id: options?.chatId,
          context: options?.context,
        }),
      });

      this.stats.messagesSent++;
      this.stats.messagesReceived++;

      return response as { response: string; metadata?: Record<string, unknown> };
    } catch (error) {
      this.stats.errors++;
      this.recordActivity({
        type: "error",
        content: `Failed to send message: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
      throw error;
    }
  }

  // ==========================================================================
  // ACTIVITY & STATUS
  // ==========================================================================

  /**
   * Get recent activity log
   * @param limit - Maximum number of entries to return
   * @param type - Filter by activity type
   */
  async getActivity(options?: {
    limit?: number;
    type?: OpenClawActivity["type"];
    since?: Date;
  }): Promise<OpenClawActivity[]> {
    let activities = [...this.activityLog];

    if (options?.type) {
      activities = activities.filter((a) => a.type === options.type);
    }

    if (options?.since) {
      activities = activities.filter((a) => a.timestamp >= options.since!);
    }

    // Sort by timestamp descending
    activities.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    if (options?.limit) {
      activities = activities.slice(0, options.limit);
    }

    return activities;
  }

  /**
   * Get current status information
   */
  async getStatus(): Promise<OpenClawStatusInfo> {
    const config = await this.loadOpenClawConfig();
    const isRunning = await this.isRunning();

    // Get comms status
    const commsStatus: OpenClawStatusInfo["comms"] = {};
    for (const platform of ["telegram", "whatsapp", "discord", "imessage"] as CommsPlatform[]) {
      const platformConfig = config.comms[platform];
      commsStatus[platform] = {
        connected: isRunning && (platformConfig?.enabled ?? false),
      };
    }

    // Fetch detailed stats from API if running
    let apiStats = { ...this.stats };
    let uptime: number | undefined;
    if (isRunning) {
      try {
        const apiStatus = await this.callOpenClawAPI("/status");
        apiStats = (apiStatus as { stats: typeof this.stats }).stats || apiStats;
        uptime = (apiStatus as { uptime?: number }).uptime;
      } catch {
        // API might not be ready yet
      }
    }

    return {
      status: this.status,
      version: config.version,
      pid: this.process?.pid,
      uptime,
      port: config.port,
      apiPort: config.apiPort,
      comms: commsStatus,
      stats: apiStats,
    };
  }

  // ==========================================================================
  // PRIVATE HELPERS
  // ==========================================================================

  private async loadOpenClawConfig(): Promise<OpenClawConfig> {
    try {
      const content = await fs.readFile(this.configPath, "utf-8");
      const parsed = YAML.load(content);
      return openClawConfigSchema.parse(parsed) as OpenClawConfig;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error("OpenClaw is not installed. Run install() first.");
      }
      if (error instanceof z.ZodError) {
        throw new Error(
          `OpenClaw configuration is invalid:\n${error.errors
            .map((e) => `  - ${e.path.join(".")}: ${e.message}`)
            .join("\n")}`
        );
      }
      throw error;
    }
  }

  private async saveOpenClawConfig(config: OpenClawConfig): Promise<void> {
    await fs.mkdir(this.openClawDir, { recursive: true });

    const yaml = YAML.dump(config, {
      indent: 2,
      lineWidth: 120,
      sortMapEntries: true,
    });

    await fs.writeFile(this.configPath, yaml, "utf-8");
  }

  private prepareEnvironment(config: OpenClawConfig): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {
      OPENCLAW_PORT: String(config.port),
      OPENCLAW_API_PORT: String(config.apiPort),
      OPENCLAW_LOG_LEVEL: config.logLevel,
      OPENCLAW_HOT_RELOAD: String(config.hotReload),
      OPENCLAW_SKILLS_DIR: this.skillsDir,

      // Intelligence provider settings
      OPENCLAW_INTELLIGENCE_PROVIDER: config.intelligence.provider,
      OPENCLAW_INTELLIGENCE_MODEL: config.intelligence.model,
    };

    if (config.intelligence.endpoint) {
      env.OPENCLAW_INTELLIGENCE_ENDPOINT = config.intelligence.endpoint;
    }
    if (config.intelligence.apiKey) {
      env.OPENCLAW_INTELLIGENCE_API_KEY = config.intelligence.apiKey;
    }
    if (config.intelligence.temperature !== undefined) {
      env.OPENCLAW_INTELLIGENCE_TEMPERATURE = String(config.intelligence.temperature);
    }
    if (config.intelligence.maxTokens !== undefined) {
      env.OPENCLAW_INTELLIGENCE_MAX_TOKENS = String(config.intelligence.maxTokens);
    }

    // Feature flags
    env.OPENCLAW_FEATURE_PROACTIVE = String(config.features.proactiveMessages);
    env.OPENCLAW_FEATURE_MEMORY = String(config.features.memoryEnabled);
    env.OPENCLAW_FEATURE_TOOLS = String(config.features.toolsEnabled);
    env.OPENCLAW_FEATURE_WEBSEARCH = String(config.features.webSearch);

    // Comms platform configs (as JSON)
    for (const [platform, platformConfig] of Object.entries(config.comms)) {
      if (platformConfig) {
        env[`OPENCLAW_${platform.toUpperCase()}_CONFIG`] = JSON.stringify(platformConfig);
      }
    }

    return env;
  }

  private setupProcessHandlers(process: ChildProcess, config: OpenClawConfig): void {
    process.on("error", (error) => {
      logger.error(`OpenClaw process error: ${error.message}`);
      this.status = "error";
      this.recordActivity({
        type: "error",
        content: `Process error: ${error.message}`,
      });
    });

    process.on("exit", (code, signal) => {
      logger.info(`OpenClaw process exited (code: ${code}, signal: ${signal})`);
      this.process = null;
      this.status = code === 0 ? "stopped" : "error";

      if (code !== 0 && code !== null) {
        this.recordActivity({
          type: "error",
          content: `Process exited with code ${code}`,
        });
      }

      // Stop status check interval
      if (this.statusCheckInterval) {
        clearInterval(this.statusCheckInterval);
        this.statusCheckInterval = null;
      }
    });

    if (process.stderr) {
      process.stderr.on("data", (data: Buffer) => {
        const message = data.toString().trim();
        if (message) {
          logger.debug(`[OpenClaw] ${message}`);
          if (message.toLowerCase().includes("error")) {
            this.recordActivity({
              type: "error",
              content: message,
            });
          }
        }
      });
    }
  }

  private async waitForStartup(port: number, timeout: number): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      try {
        // Try to connect to the health endpoint
        const response = await fetch(`http://localhost:${port}/health`, {
          signal: AbortSignal.timeout(1000),
        });
        if (response.ok) {
          return;
        }
      } catch {
        // Not ready yet, wait and retry
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    throw new Error(`OpenClaw failed to start within ${timeout}ms`);
  }

  private async checkPortInUse(port: number): Promise<boolean> {
    try {
      // Try to create a server on the port
      const net = await import("net");
      return new Promise((resolve) => {
        const server = net.createServer();
        server.once("error", (err: NodeJS.ErrnoException) => {
          if (err.code === "EADDRINUSE") {
            resolve(true);
          } else {
            resolve(false);
          }
        });
        server.once("listening", () => {
          server.close();
          resolve(false);
        });
        server.listen(port);
      });
    } catch {
      return false;
    }
  }

  private startStatusCheck(config: OpenClawConfig): void {
    // Check status every 30 seconds
    this.statusCheckInterval = setInterval(async () => {
      if (!this.process || this.process.killed) {
        return;
      }

      try {
        const response = await fetch(`http://localhost:${config.port}/health`, {
          signal: AbortSignal.timeout(5000),
        });

        if (!response.ok) {
          logger.warn("OpenClaw health check failed");
        }
      } catch {
        logger.warn("OpenClaw appears to be unreachable");
      }
    }, 30000);
  }

  private async callOpenClawAPI(
    endpoint: string,
    options?: { method?: string; body?: string; headers?: Record<string, string> }
  ): Promise<unknown> {
    const config = await this.loadOpenClawConfig();
    const url = `http://localhost:${config.apiPort}${endpoint}`;

    const response = await fetch(url, {
      method: options?.method || "GET",
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
      },
      body: options?.body,
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenClaw API error (${response.status}): ${errorText}`);
    }

    return response.json();
  }

  private async notifyConfigChange(): Promise<void> {
    // Signal OpenClaw to reload configuration
    try {
      await this.callOpenClawAPI("/system/reload", { method: "POST" });
      logger.debug("Configuration hot-reloaded");
    } catch (error) {
      logger.debug("Failed to notify config change:", error);
    }
  }

  private async reloadSkills(): Promise<void> {
    // Signal OpenClaw to reload skills
    try {
      await this.callOpenClawAPI("/skills/reload", { method: "POST" });
      logger.debug("Skills hot-reloaded");
    } catch (error) {
      logger.debug("Failed to reload skills:", error);
    }
  }

  private async fetchCommsStatusFromAPI(): Promise<Partial<Record<CommsPlatform, boolean>>> {
    try {
      const response = await this.callOpenClawAPI("/comms/status");
      return (response as { platforms: Partial<Record<CommsPlatform, boolean>> }).platforms || {};
    } catch {
      return {};
    }
  }

  private recordActivity(activity: Omit<OpenClawActivity, "id" | "timestamp">): void {
    const fullActivity: OpenClawActivity = {
      ...activity,
      id: `act-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      timestamp: new Date(),
    };

    this.activityLog.push(fullActivity);

    // Keep only last 1000 entries
    if (this.activityLog.length > 1000) {
      this.activityLog = this.activityLog.slice(-1000);
    }
  }

  private getFileExtension(language: SkillLanguage): string {
    switch (language) {
      case "typescript":
        return "ts";
      case "javascript":
        return "js";
      case "python":
        return "py";
      default:
        return "js";
    }
  }
}

// ============================================================================
// SINGLETON EXPORT
// ============================================================================

/**
 * Singleton instance of OpenClawService
 * Use this for all OpenClaw operations
 */
export const openclawService = new OpenClawService();
