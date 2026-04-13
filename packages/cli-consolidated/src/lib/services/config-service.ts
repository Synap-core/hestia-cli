/**
 * Config Service
 * 
 * Handles Hestia configuration load/save operations
 * Wraps the existing config utilities with a service interface
 * Implements IConfigService for contract clarity and testability
 */

import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import * as YAML from "js-yaml";
import { logger } from '../utils/logger.js';
import type { HestiaConfig } from '../types/index.js';
import type { IConfigService } from './interfaces.js';

// Re-export types from existing modules
export type { HestiaConfig };

/**
 * Configuration paths
 */
export function getConfigPaths() {
  const homeDir = os.homedir();
  const configDir = process.env.HESTIA_CONFIG_DIR || path.join(homeDir, ".hestia");
  const systemConfigDir = "/etc/hestia";

  return {
    configDir,
    systemConfigDir,
    userConfig: path.join(configDir, "config.yaml"),
    systemConfig: path.join(systemConfigDir, "config.yaml"),
    credentials: path.join(configDir, "credentials.yaml"),
    packagesDir: path.join(configDir, "packages"),
    registryCache: path.join(configDir, "registry-cache.yaml"),
  };
}

/**
 * Config Service
 * Handles Hestia configuration load/save operations
 * Implements IConfigService for contract clarity and testability
 */
export class ConfigService implements IConfigService {
  private configPath: string;

  constructor(customPath?: string) {
    const paths = getConfigPaths();
    this.configPath = customPath || paths.userConfig;
  }

  /**
   * Load Hestia configuration from file
   * Implements IConfigService.load()
   */
  async load(): Promise<HestiaConfig> {
    const { config } = await this.loadConfig();
    return config;
  }

  /**
   * Load Hestia configuration from file with metadata
   */
  async loadConfig(): Promise<{ config: HestiaConfig; path: string }> {
    try {
      const content = await fs.readFile(this.configPath, "utf-8");
      const parsed = YAML.load(content) as HestiaConfig;
      logger.debug("ConfigService: Loaded config from", this.configPath);
      return { config: parsed, path: this.configPath };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        // Config doesn't exist, return minimal default
        const defaultConfig: HestiaConfig = {
          version: "1.0",
          hearth: {
            id: "",
            name: "My Digital Hearth",
            role: "primary",
            reverseProxy: "nginx",
          },
          packages: {},
        };
        return { config: defaultConfig, path: this.configPath };
      }
      throw new ConfigServiceError(
        `Failed to load config: ${(error as Error).message}`,
        "LOAD_FAILED",
        error
      );
    }
  }

  /**
   * Save Hestia configuration to file
   * Implements IConfigService.save()
   */
  async save(config: HestiaConfig): Promise<void> {
    try {
      // Ensure directory exists
      await fs.mkdir(path.dirname(this.configPath), { recursive: true });

      // Serialize to YAML
      const yaml = YAML.dump(config, {
        indent: 2,
        lineWidth: 120,
      });

      await fs.writeFile(this.configPath, yaml, "utf-8");
      logger.debug("ConfigService: Saved config to", this.configPath);
    } catch (error) {
      throw new ConfigServiceError(
        `Failed to save config: ${(error as Error).message}`,
        "SAVE_FAILED",
        error
      );
    }
  }

  /**
   * Save Hestia configuration to file (legacy method)
   */
  async saveConfig(config: HestiaConfig): Promise<void> {
    return this.save(config);
  }

  /**
   * Update specific configuration fields
   * Implements IConfigService.update()
   */
  async update(updates: Partial<HestiaConfig>): Promise<HestiaConfig> {
    const { config } = await this.loadConfig();
    const updated = { ...config, ...updates };
    
    // Deep merge for nested objects
    if (updates.hearth) {
      updated.hearth = { ...config.hearth, ...updates.hearth };
    }
    if (updates.intelligence) {
      updated.intelligence = { ...config.intelligence, ...updates.intelligence };
    }
    if (updates.packages) {
      updated.packages = { ...config.packages, ...updates.packages };
    }

    await this.save(updated);
    return updated;
  }

  /**
   * Update specific configuration fields (legacy method)
   */
  async updateConfig(updates: Partial<HestiaConfig>): Promise<HestiaConfig> {
    return this.update(updates);
  }

  /**
   * Validate unknown data as HestiaConfig
   * Implements IConfigService.validate()
   */
  validate(config: unknown): config is HestiaConfig {
    if (typeof config !== 'object' || config === null) {
      return false;
    }
    
    const c = config as Record<string, unknown>;
    
    // Check required fields
    if (typeof c.version !== 'string') return false;
    if (typeof c.hearth !== 'object' || c.hearth === null) return false;
    
    const hearth = c.hearth as Record<string, unknown>;
    if (typeof hearth.name !== 'string') return false;
    if (typeof hearth.role !== 'string') return false;
    if (typeof c.packages !== 'object' || c.packages === null) return false;
    
    return true;
  }

  /**
   * Get config file path
   */
  getConfigPath(): string {
    return this.configPath;
  }

  /**
   * Check if config file exists
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
 * Config Service Error
 */
export class ConfigServiceError extends Error {
  constructor(
    message: string,
    public code: string,
    public cause?: unknown
  ) {
    super(message);
    this.name = "ConfigServiceError";
  }
}

// Singleton instance for convenience
export const configService = new ConfigService();

// Backward-compatible exports
export const loadConfig = (customPath?: string) => new ConfigService(customPath).loadConfig();
export const saveConfig = (config: HestiaConfig, customPath?: string) => 
  new ConfigService(customPath).saveConfig(config);
export const updateConfig = (updates: Partial<HestiaConfig>, customPath?: string) => 
  new ConfigService(customPath).updateConfig(updates);
