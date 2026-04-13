/**
 * OpenClaw Sync Service
 * 
 * Handles synchronization between Hestia config and OpenClaw configuration
 */

import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { logger } from '../utils/logger.js';
import type { HestiaConfig } from './config-service.js';

/**
 * OpenClaw configuration format
 */
export interface OpenClawConfig {
  version: string;
  server?: {
    host?: string;
    port?: number;
    ssl?: boolean;
  };
  auth?: {
    type: "token" | "oauth" | "basic";
    token?: string;
    username?: string;
    password?: string;
  };
  providers?: Array<{
    name: string;
    type: string;
    endpoint?: string;
    apiKey?: string;
    enabled: boolean;
    models?: string[];
  }>;
  defaults?: {
    provider?: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
  };
  integrations?: {
    synap?: {
      enabled: boolean;
      hearthNodeId?: string;
      apiKey?: string;
      podUrl?: string;
    };
  };
  lastSynced?: string;
}

/**
 * Get OpenClaw config paths
 */
export function getOpenClawPaths() {
  const homeDir = os.homedir();
  return {
    openclaw: path.join(homeDir, ".openclaw", "config.json"),
    openclawDir: path.join(homeDir, ".openclaw"),
  };
}

/**
 * OpenClaw Sync Service
 * Handles bidirectional sync between Hestia and OpenClaw
 */
export class OpenClawSync {
  private configPath: string;
  private configDir: string;

  constructor(customPath?: string) {
    const paths = getOpenClawPaths();
    this.configPath = customPath || paths.openclaw;
    this.configDir = paths.openclawDir;
  }

  /**
   * Load OpenClaw config from file
   */
  async loadConfig(): Promise<OpenClawConfig | null> {
    try {
      const content = await fs.readFile(this.configPath, "utf-8");
      const config = JSON.parse(content) as OpenClawConfig;
      logger.debug("OpenClawSync: Loaded config from", this.configPath);
      return config;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      logger.warn("OpenClawSync: Error loading config", error);
      return null;
    }
  }

  /**
   * Save OpenClaw config to file
   */
  async saveConfig(config: OpenClawConfig): Promise<void> {
    try {
      // Ensure directory exists
      await fs.mkdir(this.configDir, { recursive: true });

      // Update last synced timestamp
      config.lastSynced = new Date().toISOString();

      await fs.writeFile(
        this.configPath,
        JSON.stringify(config, null, 2),
        "utf-8"
      );
      logger.debug("OpenClawSync: Saved config to", this.configPath);
    } catch (error) {
      throw new OpenClawSyncError(
        `Failed to save OpenClaw config: ${(error as Error).message}`,
        "SAVE_FAILED",
        error
      );
    }
  }

  /**
   * Translate Hestia config to OpenClaw config format
   */
  translateToOpenClawConfig(config: HestiaConfig): OpenClawConfig {
    const providers: OpenClawConfig["providers"] = [];

    // Add intelligence provider if configured
    if (config.intelligence) {
      providers.push({
        name: config.intelligence.provider,
        type: config.intelligence.provider,
        endpoint: config.intelligence.endpoint,
        apiKey: config.intelligence.apiKey,
        enabled: true,
        models: [config.intelligence.model],
      });
    }

    return {
      version: "1.0",
      server: {
        host: "0.0.0.0",
        port: 3333,
        ssl: false,
      },
      auth: {
        type: "token",
        token: process.env.OPENCLAW_TOKEN,
      },
      providers,
      defaults: {
        provider: config.intelligence?.provider,
        model: config.intelligence?.model,
        temperature: config.intelligence?.temperature,
        maxTokens: config.intelligence?.maxTokens,
      },
      integrations: {
        synap: {
          enabled: true,
          hearthNodeId: config.hearth.id,
          apiKey: process.env.HESTIA_API_KEY ?? process.env.SYNAP_API_KEY,
          podUrl: process.env.HESTIA_POD_URL ?? "http://localhost:4000",
        },
      },
      lastSynced: new Date().toISOString(),
    };
  }

  /**
   * Extract Hestia config updates from OpenClaw config
   */
  translateFromOpenClawConfig(config: OpenClawConfig): Partial<HestiaConfig> {
    const updates: Partial<HestiaConfig> = {};

    if (config.integrations?.synap?.hearthNodeId) {
      updates.hearth = {
        id: config.integrations.synap.hearthNodeId,
        name: "My Digital Hearth",
        role: "primary",
        reverseProxy: "nginx",
      };
    }

    if (config.defaults) {
      const provider = config.providers?.find(p => p.name === config.defaults?.provider);
      updates.intelligence = {
        provider: (config.defaults.provider as "ollama" | "openrouter" | "anthropic" | "openai" | "custom") ?? "ollama",
        model: config.defaults.model ?? "llama3.1:8b",
        temperature: config.defaults.temperature,
        maxTokens: config.defaults.maxTokens,
        endpoint: provider?.endpoint,
        apiKey: provider?.apiKey,
      };
    }

    return updates;
  }

  /**
   * Sync Hestia config to OpenClaw
   */
  async syncToOpenClaw(config: HestiaConfig): Promise<void> {
    const openclawConfig = this.translateToOpenClawConfig(config);
    await this.saveConfig(openclawConfig);
    logger.success("OpenClawSync: Synced config to OpenClaw");
  }

  /**
   * Sync from OpenClaw to Hestia config
   */
  async syncFromOpenClaw(): Promise<Partial<HestiaConfig>> {
    const config = await this.loadConfig();
    if (!config) {
      throw new OpenClawSyncError(
        "No OpenClaw config found",
        "CONFIG_NOT_FOUND"
      );
    }
    return this.translateFromOpenClawConfig(config);
  }

  /**
   * Get config file path
   */
  getConfigPath(): string {
    return this.configPath;
  }

  /**
   * Check if config exists
   */
  async configExists(): Promise<boolean> {
    try {
      await fs.access(this.configPath);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * OpenClaw Sync Error
 */
export class OpenClawSyncError extends Error {
  constructor(
    message: string,
    public code: string,
    public cause?: unknown
  ) {
    super(message);
    this.name = "OpenClawSyncError";
  }
}

// Singleton instance for convenience
export const openClawSync = new OpenClawSync();

// Backward-compatible exports
export const loadOpenClawConfig = () => openClawSync.loadConfig();
export const saveOpenClawConfig = (config: OpenClawConfig) => 
  openClawSync.saveConfig(config);
export const translateToOpenClaw = (config: HestiaConfig) => 
  openClawSync.translateToOpenClawConfig(config);
