/**
 * OpenClaude Sync Service
 * 
 * Handles synchronization between Hestia config and OpenClaude profile
 */

import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { logger } from '../utils/logger.js';
import type { HestiaConfig } from './config-service.js';

/**
 * OpenClaude profile configuration format
 */
export interface OpenClaudeProfile {
  version: string;
  profile: {
    name: string;
    email?: string;
    preferences: {
      theme: "light" | "dark" | "system";
      language: string;
      timezone?: string;
    };
    ai: {
      provider: string;
      model: string;
      temperature?: number;
      maxTokens?: number;
      apiKey?: string;
      endpoint?: string;
    };
    integrations: {
      synap?: {
        enabled: boolean;
        podUrl?: string;
        apiKey?: string;
        workspaceId?: string;
      };
      openclaw?: {
        enabled: boolean;
        endpoint?: string;
        apiKey?: string;
      };
    };
    customSettings?: Record<string, unknown>;
  };
  lastSynced?: string;
}

/**
 * Get OpenClaude config paths
 */
export function getOpenClaudePaths() {
  const homeDir = os.homedir();
  return {
    openclaude: path.join(homeDir, ".openclaude-profile.json"),
  };
}

/**
 * OpenClaude Sync Service
 * Handles bidirectional sync between Hestia and OpenClaude
 */
export class OpenClaudeSync {
  private profilePath: string;

  constructor(customPath?: string) {
    const paths = getOpenClaudePaths();
    this.profilePath = customPath || paths.openclaude;
  }

  /**
   * Load OpenClaude profile from file
   */
  async loadProfile(): Promise<OpenClaudeProfile | null> {
    try {
      const content = await fs.readFile(this.profilePath, "utf-8");
      const profile = JSON.parse(content) as OpenClaudeProfile;
      logger.debug("OpenClaudeSync: Loaded profile from", this.profilePath);
      return profile;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      logger.warn("OpenClaudeSync: Error loading profile", error);
      return null;
    }
  }

  /**
   * Save OpenClaude profile to file
   */
  async saveProfile(profile: OpenClaudeProfile): Promise<void> {
    try {
      // Ensure directory exists
      await fs.mkdir(path.dirname(this.profilePath), { recursive: true });

      // Update last synced timestamp
      profile.lastSynced = new Date().toISOString();

      await fs.writeFile(
        this.profilePath,
        JSON.stringify(profile, null, 2),
        "utf-8"
      );
      logger.debug("OpenClaudeSync: Saved profile to", this.profilePath);
    } catch (error) {
      throw new OpenClaudeSyncError(
        `Failed to save OpenClaude profile: ${(error as Error).message}`,
        "SAVE_FAILED",
        error
      );
    }
  }

  /**
   * Translate Hestia config to OpenClaude profile format
   */
  translateToOpenClaudeProfile(config: HestiaConfig): OpenClaudeProfile {
    return {
      version: "1.0",
      profile: {
        name: config.hearth.name,
        preferences: {
          theme: "system",
          language: "en",
        },
        ai: {
          provider: config.intelligence?.provider ?? "synap",
          model: config.intelligence?.model ?? "llama3.1:8b",
          temperature: config.intelligence?.temperature,
          maxTokens: config.intelligence?.maxTokens,
          apiKey: config.intelligence?.apiKey,
          endpoint: config.intelligence?.endpoint,
        },
        integrations: {
          synap: {
            enabled: true,
            podUrl: process.env.HESTIA_POD_URL ?? process.env.SYNAP_POD_URL,
            apiKey: process.env.HESTIA_API_KEY ?? process.env.SYNAP_API_KEY,
            workspaceId: config.pod?.workspaceId,
          },
          openclaw: {
            enabled: config.packages?.openclaw?.enabled ?? false,
            endpoint: process.env.OPENCLAW_ENDPOINT,
            apiKey: process.env.OPENCLAW_API_KEY,
          },
        },
        customSettings: {
          hearthId: config.hearth.id,
          hearthRole: config.hearth.role,
          hearthDomain: config.hearth.domain,
        },
      },
      lastSynced: new Date().toISOString(),
    };
  }

  /**
   * Extract Hestia config updates from OpenClaude profile
   */
  translateFromOpenClaudeProfile(profile: OpenClaudeProfile): Partial<HestiaConfig> {
    const updates: Partial<HestiaConfig> = {};

    if (profile.profile.name) {
      updates.hearth = {
        name: profile.profile.name,
        role: (profile.profile.customSettings?.hearthRole as "primary" | "backup") ?? "primary",
        id: (profile.profile.customSettings?.hearthId as string) ?? "",
        domain: (profile.profile.customSettings?.hearthDomain as string) ?? undefined,
        reverseProxy: "nginx",
      };
    }

    if (profile.profile.ai) {
      updates.intelligence = {
        provider: profile.profile.ai.provider as "ollama" | "openrouter" | "anthropic" | "openai" | "custom",
        model: profile.profile.ai.model,
        temperature: profile.profile.ai.temperature,
        maxTokens: profile.profile.ai.maxTokens,
        apiKey: profile.profile.ai.apiKey,
        endpoint: profile.profile.ai.endpoint,
      };
    }

    return updates;
  }

  /**
   * Sync Hestia config to OpenClaude profile
   */
  async syncToOpenClaude(config: HestiaConfig): Promise<void> {
    const profile = this.translateToOpenClaudeProfile(config);
    await this.saveProfile(profile);
    logger.success("OpenClaudeSync: Synced config to OpenClaude profile");
  }

  /**
   * Sync from OpenClaude profile to Hestia config
   */
  async syncFromOpenClaude(): Promise<Partial<HestiaConfig>> {
    const profile = await this.loadProfile();
    if (!profile) {
      throw new OpenClaudeSyncError(
        "No OpenClaude profile found",
        "PROFILE_NOT_FOUND"
      );
    }
    return this.translateFromOpenClaudeProfile(profile);
  }

  /**
   * Get profile file path
   */
  getProfilePath(): string {
    return this.profilePath;
  }

  /**
   * Check if profile exists
   */
  async profileExists(): Promise<boolean> {
    try {
      await fs.access(this.profilePath);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * OpenClaude Sync Error
 */
export class OpenClaudeSyncError extends Error {
  constructor(
    message: string,
    public code: string,
    public cause?: unknown
  ) {
    super(message);
    this.name = "OpenClaudeSyncError";
  }
}

// Singleton instance for convenience
export const openClaudeSync = new OpenClaudeSync();

// Backward-compatible exports
export const loadOpenClaudeProfile = () => openClaudeSync.loadProfile();
export const saveOpenClaudeProfile = (profile: OpenClaudeProfile) => 
  openClaudeSync.saveProfile(profile);
export const translateToOpenClaude = (config: HestiaConfig) => 
  openClaudeSync.translateToOpenClaudeProfile(config);
