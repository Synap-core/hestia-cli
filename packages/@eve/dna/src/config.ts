/**
 * Configuration Manager - Handles eve configuration persistence
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import yaml from 'js-yaml';
import { z } from 'zod';
import type { EveConfig, Organ, OrganConfig, ConfigFile } from './types.js';

const OrganSchema = z.enum(['brain', 'arms', 'builder', 'eyes', 'legs']);

const OrganConfigSchema = z.object({
  enabled: z.boolean(),
  autoStart: z.boolean(),
  port: z.number().optional(),
  environment: z.record(z.string()).optional(),
});

const ConfigSchema = z.object({
  name: z.string().min(1),
  version: z.string().default('0.1.0'),
  aiModel: z.enum(['ollama', 'none']).default('none'),
  organs: z.record(OrganConfigSchema),
  settings: z.object({
    logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    autoUpdate: z.boolean().default(true),
    defaultTimeout: z.number().default(30000),
  }),
  createdAt: z.string().datetime().or(z.date()),
  updatedAt: z.string().datetime().or(z.date()),
});

/** Default configuration for new entities */
const defaultConfig: Omit<EveConfig, 'name' | 'createdAt' | 'updatedAt'> = {
  version: '0.1.0',
  aiModel: 'none',
  organs: {
    brain: { enabled: false, autoStart: false },
    arms: { enabled: false, autoStart: false },
    builder: { enabled: false, autoStart: false },
    eyes: { enabled: false, autoStart: false },
    legs: { enabled: false, autoStart: false },
  },
  settings: {
    logLevel: 'info',
    autoUpdate: true,
    defaultTimeout: 30000,
  },
};

/** Ensure all organs are present in the config */
function ensureAllOrgans(
  organs: Partial<Record<Organ, OrganConfig>>
): EveConfig['organs'] {
  const allOrgans: Organ[] = ['brain', 'arms', 'builder', 'eyes', 'legs'];
  const result: Partial<EveConfig['organs']> = {};
  
  for (const organ of allOrgans) {
    result[organ] = {
      enabled: organs[organ]?.enabled ?? false,
      autoStart: organs[organ]?.autoStart ?? false,
      port: organs[organ]?.port,
      environment: organs[organ]?.environment,
    };
  }
  
  return result as EveConfig['organs'];
}

/** Manages eve configuration loading and saving */
export class ConfigManager {
  private config: EveConfig | null = null;

  /**
   * Get the path to the configuration directory
   */
  getConfigDir(): string {
    return join(homedir(), '.config', 'eve');
  }

  /**
   * Get the full path to the configuration file
   */
  getConfigPath(): string {
    return join(this.getConfigDir(), 'config.yaml');
  }

  /**
   * Ensure the configuration directory exists
   */
  private async ensureConfigDir(): Promise<void> {
    const configDir = this.getConfigDir();
    try {
      await fs.mkdir(configDir, { recursive: true });
    } catch (error) {
      throw new Error(`Failed to create config directory: ${(error as Error).message}`);
    }
  }

  /**
   * Load configuration from disk
   * Creates default config if none exists
   */
  async loadConfig(): Promise<EveConfig> {
    try {
      await this.ensureConfigDir();
      const configPath = this.getConfigPath();
      
      try {
        const content = await fs.readFile(configPath, 'utf-8');
        const parsed = yaml.load(content) as ConfigFile;
        
        // Validate with zod
        const validated = ConfigSchema.parse(parsed);
        
        this.config = {
          ...validated,
          organs: ensureAllOrgans(validated.organs),
          createdAt: new Date(validated.createdAt),
          updatedAt: new Date(validated.updatedAt),
        };
        
        return this.config;
      } catch (readError) {
        if ((readError as NodeJS.ErrnoException).code === 'ENOENT') {
          // Config doesn't exist, create default
          return this.createDefaultConfig('default-entity');
        }
        throw readError;
      }
    } catch (error) {
      throw new Error(`Failed to load config: ${(error as Error).message}`);
    }
  }

  /**
   * Create a new default configuration
   */
  async createDefaultConfig(name: string): Promise<EveConfig> {
    const now = new Date();
    this.config = {
      ...defaultConfig,
      name,
      createdAt: now,
      updatedAt: now,
    };
    
    await this.saveConfig(this.config);
    return this.config;
  }

  /**
   * Save configuration to disk
   */
  async saveConfig(config: EveConfig): Promise<void> {
    try {
      await this.ensureConfigDir();
      
      const configFile: ConfigFile = {
        ...config,
        organs: ensureAllOrgans(config.organs),
        createdAt: config.createdAt.toISOString(),
        updatedAt: config.updatedAt.toISOString(),
      };
      
      const content = yaml.dump(configFile, {
        indent: 2,
        lineWidth: -1,
        noRefs: true,
        sortKeys: false,
      });
      
      await fs.writeFile(this.getConfigPath(), content, 'utf-8');
      this.config = config;
    } catch (error) {
      throw new Error(`Failed to save config: ${(error as Error).message}`);
    }
  }

  /**
   * Update configuration with partial updates
   */
  async updateConfig(updates: Partial<EveConfig>): Promise<EveConfig> {
    const current = await this.loadConfig();
    
    const updated: EveConfig = {
      ...current,
      ...updates,
      organs: updates.organs
        ? ensureAllOrgans({ ...current.organs, ...updates.organs })
        : current.organs,
      updatedAt: new Date(),
    };
    
    await this.saveConfig(updated);
    return updated;
  }

  /**
   * Get current config without reloading
   */
  getCachedConfig(): EveConfig | null {
    return this.config;
  }
}

/** Singleton instance */
export const configManager = new ConfigManager();
