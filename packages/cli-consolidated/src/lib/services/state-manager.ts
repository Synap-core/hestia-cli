/**
 * State Manager (Refactored)
 * 
 * A simplified StateManager that coordinates specialized services:
 * - ConfigService: Hestia config load/save
 * - CredentialsService: Credentials management (wraps existing utilities)
 * - OpenClaudeSync: Sync to OpenClaude profile
 * - OpenClawSync: Sync to OpenClaw
 * - APIService: Synap backend API client
 * 
 * This replaces the original 1,162-line UnifiedStateManager with a thin
 * orchestration layer that delegates to focused services.
 */

import { ConfigService, ConfigServiceError, type HestiaConfig } from './config-service.js';
import { OpenClaudeSync, OpenClaudeSyncError, type OpenClaudeProfile } from './openclaude-sync.js';
import { OpenClawSync, OpenClawSyncError, type OpenClawConfig } from './openclaw-sync.js';
import { APIService, APIServiceError, type NormalState, type APIServiceConfig } from './api-service.js';
import * as credentials from '../utils/credentials.js';
import { logger } from '../utils/logger.js';

// Re-export types for backward compatibility
export type { HestiaConfig, OpenClaudeProfile, OpenClawConfig, NormalState };
export { ConfigServiceError, OpenClaudeSyncError, OpenClawSyncError, APIServiceError };

// Re-export credentials utilities
export const { 
  loadCredentials, 
  saveCredentials, 
  getCredential, 
  setCredential,
  removeCredential,
  listCredentials,
  hasCredential,
  validateCredential,
  getAllCredentials,
  clearAllCredentials,
} = credentials;

/**
 * Conflict resolution strategy
 */
export type ConflictStrategy = "synap-wins" | "local-wins" | "newest-wins" | "manual";

/**
 * Sync result with detailed information
 */
export interface SyncResult {
  success: boolean;
  direction: "to-synap" | "to-local" | "bidirectional" | "none";
  conflicts: Array<{
    key: string;
    synapValue: unknown;
    localValue: unknown;
    resolution: "synap" | "local" | "merged";
  }>;
  changes: {
    synap: string[];
    local: string[];
  };
  errors: string[];
}

/**
 * State manager options
 */
export interface StateManagerOptions {
  /** Conflict resolution strategy */
  conflictStrategy?: ConflictStrategy;
  /** Enable automatic sync on file changes */
  autoSync?: boolean;
  /** Sync interval in milliseconds (0 to disable) */
  syncInterval?: number;
  /** Custom logger instance */
  logger?: typeof logger;
  /** Custom config path */
  configPath?: string;
  /** Custom OpenClaude profile path */
  openClaudePath?: string;
  /** Custom OpenClaw config path */
  openClawPath?: string;
}

/**
 * Local state - OpenClaude + OpenClaw configs
 */
export interface LocalState {
  openclaude: OpenClaudeProfile | null;
  openclaw: OpenClawConfig | null;
  paths: {
    openclaude: string;
    openclaw: string;
  };
  lastSynced: Date;
}

/**
 * Runtime state - Environment + Memory
 */
export interface RuntimeState {
  environment: Record<string, string | undefined>;
  memory: Map<string, unknown>;
  timestamp: Date;
}

/**
 * State Manager
 * 
 * A simplified orchestration layer that coordinates specialized services.
 * This replaces the original monolithic UnifiedStateManager.
 */
export class StateManager {
  // Services
  private configService: ConfigService;
  private openClaudeSync: OpenClaudeSync;
  private openClawSync: OpenClawSync;
  private apiService: APIService;

  // State
  private runtimeState: RuntimeState;
  private options: Required<StateManagerOptions>;
  private isSyncing = false;
  private syncIntervalId: NodeJS.Timeout | null = null;

  constructor(options: StateManagerOptions = {}) {
    this.options = {
      conflictStrategy: options.conflictStrategy ?? "synap-wins",
      autoSync: options.autoSync ?? true,
      syncInterval: options.syncInterval ?? 60000,
      logger: options.logger ?? logger,
      configPath: options.configPath ?? "",
      openClaudePath: options.openClaudePath ?? "",
      openClawPath: options.openClawPath ?? "",
    };

    // Initialize services
    this.configService = new ConfigService(this.options.configPath);
    this.openClaudeSync = new OpenClaudeSync(this.options.openClaudePath);
    this.openClawSync = new OpenClawSync(this.options.openClawPath);
    this.apiService = new APIService();

    // Initialize runtime state
    this.runtimeState = {
      environment: { ...process.env },
      memory: new Map(),
      timestamp: new Date(),
    };
  }

  // ============================================================================
  // Initialization
  // ============================================================================

  /**
   * Initialize the state manager with API client
   */
  async initialize(apiClientConfig?: Partial<APIServiceConfig>): Promise<void> {
    try {
      await this.apiService.initialize(apiClientConfig);
      this.options.logger.debug("StateManager: API service initialized");
    } catch (error) {
      this.options.logger.warn("StateManager: Failed to initialize API service, operating in local-only mode", error);
    }

    // Setup auto-sync if enabled
    if (this.options.autoSync && this.options.syncInterval > 0) {
      this.syncIntervalId = setInterval(() => {
        this.syncAll().catch((err) => {
          this.options.logger.error("StateManager: Scheduled sync failed", err);
        });
      }, this.options.syncInterval);
    }

    this.options.logger.info("StateManager: Initialized successfully");
  }

  /**
   * Shutdown the state manager and cleanup resources
   */
  async shutdown(): Promise<void> {
    // Stop sync interval
    if (this.syncIntervalId) {
      clearInterval(this.syncIntervalId);
      this.syncIntervalId = null;
    }

    // Clear memory cache
    this.runtimeState.memory.clear();

    this.options.logger.info("StateManager: Shutdown complete");
  }

  // ============================================================================
  // Config Operations (via ConfigService)
  // ============================================================================

  /**
   * Load Hestia configuration
   */
  async loadConfig(): Promise<{ config: HestiaConfig; path: string }> {
    return this.configService.loadConfig();
  }

  /**
   * Save Hestia configuration
   */
  async saveConfig(config: HestiaConfig): Promise<void> {
    return this.configService.saveConfig(config);
  }

  /**
   * Update Hestia configuration
   */
  async updateConfig(updates: Partial<HestiaConfig>): Promise<HestiaConfig> {
    return this.configService.updateConfig(updates);
  }

  // ============================================================================
  // Local State Operations (via OpenClaudeSync and OpenClawSync)
  // ============================================================================

  /**
   * Get local state from OpenClaude and OpenClaw config files
   */
  async getLocalState(): Promise<LocalState> {
    const [openclaude, openclaw] = await Promise.all([
      this.openClaudeSync.loadProfile(),
      this.openClawSync.loadConfig(),
    ]);

    return {
      openclaude,
      openclaw,
      paths: {
        openclaude: this.openClaudeSync.getProfilePath(),
        openclaw: this.openClawSync.getConfigPath(),
      },
      lastSynced: new Date(),
    };
  }

  /**
   * Save local state to OpenClaude and/or OpenClaw
   */
  async saveLocalState(updates: {
    openclaude?: Partial<OpenClaudeProfile>;
    openclaw?: Partial<OpenClawConfig>;
  }): Promise<LocalState> {
    if (updates.openclaude) {
      const fullProfile: OpenClaudeProfile = {
        version: "1.0",
        profile: {
          name: "",
          preferences: { theme: "system", language: "en" },
          ai: { provider: "synap", model: "llama3.1:8b" },
          integrations: { synap: { enabled: true } },
          ...updates.openclaude.profile,
        },
        lastSynced: new Date().toISOString(),
        ...updates.openclaude,
      };
      await this.openClaudeSync.saveProfile(fullProfile);
    }

    if (updates.openclaw) {
      const fullConfig: OpenClawConfig = {
        version: "1.0",
        ...updates.openclaw,
        lastSynced: new Date().toISOString(),
      };
      await this.openClawSync.saveConfig(fullConfig);
    }

    return this.getLocalState();
  }

  // ============================================================================
  // Runtime State Operations
  // ============================================================================

  /**
   * Get current runtime state
   */
  getRuntimeState(): RuntimeState {
    return {
      environment: { ...process.env },
      memory: new Map(this.runtimeState.memory),
      timestamp: new Date(),
    };
  }

  /**
   * Set a value in runtime memory
   */
  setRuntimeValue<T>(key: string, value: T): void {
    this.runtimeState.memory.set(key, value);
    this.runtimeState.timestamp = new Date();
  }

  /**
   * Get a value from runtime memory
   */
  getRuntimeValue<T>(key: string, defaultValue?: T): T | undefined {
    return (this.runtimeState.memory.get(key) as T) ?? defaultValue;
  }

  /**
   * Get an environment variable
   */
  getEnvVar(key: string, defaultValue?: string): string | undefined {
    return process.env[key] ?? defaultValue;
  }

  /**
   * Set an environment variable
   */
  setEnvVar(key: string, value: string): void {
    process.env[key] = value;
    this.runtimeState.environment[key] = value;
    this.runtimeState.timestamp = new Date();
  }

  // ============================================================================
  // Normal State Operations (via APIService)
  // ============================================================================

  /**
   * Get normal state from Synap backend
   */
  async getNormalState(): Promise<NormalState> {
    const { config } = await this.configService.loadConfig();

    if (!this.apiService.isConnected() || !config.hearth.id) {
      // Local-only mode
      return {
        config,
        entities: {},
        lastSynced: new Date(),
        source: "local",
      };
    }

    try {
      const status = await this.apiService.getHearthStatus(config.hearth.id);
      
      return {
        config,
        entities: {
          hearthNode: status.hearthNode,
          packages: status.packages,
          intelligenceProvider: status.intelligenceProvider,
        },
        lastSynced: new Date(),
        source: "synap",
      };
    } catch (error) {
      this.options.logger.warn("StateManager: Failed to fetch from Synap, using local state", error);
      return {
        config,
        entities: {},
        lastSynced: new Date(),
        source: "local",
      };
    }
  }

  /**
   * Push state to Synap backend
   */
  async pushToSynap(config: HestiaConfig): Promise<void> {
    return this.apiService.pushToSynap(config);
  }

  /**
   * Pull state from Synap backend
   */
  async pullFromSynap(hearthId?: string): Promise<NormalState> {
    return this.apiService.pullFromSynap(hearthId);
  }

  /**
   * Set normal state - updates configuration and syncs to backends
   */
  async setNormalState(updates: Partial<HestiaConfig>): Promise<NormalState> {
    if (this.isSyncing) {
      throw new StateManagerError("Sync already in progress", "SYNC_IN_PROGRESS");
    }

    this.isSyncing = true;

    try {
      // Update local config
      const updatedConfig = await this.configService.update(updates);
      this.options.logger.debug("StateManager: Updated normal state config");

      // Push to Synap if connected
      if (this.apiService.isConnected() && updatedConfig.hearth.id) {
        try {
          await this.apiService.pushToSynap(updatedConfig);
          this.options.logger.debug("StateManager: Synced normal state to Synap");
        } catch (error) {
          this.options.logger.warn("StateManager: Failed to sync to Synap backend", error);
          // Don't throw - local save succeeded
        }
      }

      // Return updated state
      return this.getNormalState();
    } catch (error) {
      this.options.logger.error("StateManager: Failed to set normal state", error);
      throw new StateManagerError("Failed to update normal state", "SET_NORMAL_STATE_FAILED", error);
    } finally {
      this.isSyncing = false;
    }
  }

  // ============================================================================
  // Sync Operations
  // ============================================================================

  /**
   * Sync all: Hestia config -> OpenClaude + OpenClaw
   */
  async syncAll(): Promise<SyncResult> {
    if (this.isSyncing) {
      return {
        success: false,
        direction: "none",
        conflicts: [],
        changes: { synap: [], local: [] },
        errors: ["Sync already in progress"],
      };
    }

    this.isSyncing = true;
    this.options.logger.info("StateManager: Starting sync");

    const result: SyncResult = {
      success: true,
      direction: "to-local",
      conflicts: [],
      changes: { synap: [], local: [] },
      errors: [],
    };

    try {
      // Load Hestia config
      const { config } = await this.configService.loadConfig();

      // Sync to OpenClaude
      try {
        await this.openClaudeSync.syncToOpenClaude(config);
        result.changes.local.push("openclaude-profile");
      } catch (error) {
        result.errors.push(`OpenClaude sync failed: ${(error as Error).message}`);
      }

      // Sync to OpenClaw
      try {
        await this.openClawSync.syncToOpenClaw(config);
        result.changes.local.push("openclaw-config");
      } catch (error) {
        result.errors.push(`OpenClaw sync failed: ${(error as Error).message}`);
      }

      // Sync environment variables
      this.syncEnvironment(config);
      result.changes.local.push("environment");

      // Push to Synap if connected
      if (this.apiService.isConnected() && config.hearth.id) {
        try {
          await this.apiService.pushToSynap(config);
          result.changes.synap.push("hearth-config");
          result.direction = "bidirectional";
        } catch (error) {
          result.errors.push(`Synap push failed: ${(error as Error).message}`);
        }
      }

      result.success = result.errors.length === 0;
      this.options.logger.success("StateManager: Sync completed");
      return result;
    } catch (error) {
      result.success = false;
      result.errors.push((error as Error).message);
      this.options.logger.error("StateManager: Sync failed", error);
      return result;
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Sync configuration to local state (OpenClaude/OpenClaw)
   * Used by deploy command to push config to AI platforms
   */
  async syncToLocal(config: { config: Partial<HestiaConfig> }): Promise<void> {
    try {
      this.options.logger.info("StateManager: Syncing config to local state");
      
      // Get current config
      const { config: currentConfig } = await this.configService.loadConfig();
      
      // Merge with provided config
      const mergedConfig: HestiaConfig = {
        ...currentConfig,
        ...config.config,
      };

      // Sync to OpenClaude
      await this.openClaudeSync.syncToOpenClaude(mergedConfig);
      
      // Sync to OpenClaw
      await this.openClawSync.syncToOpenClaw(mergedConfig);

      this.options.logger.success("StateManager: Config synced to local state");
    } catch (error) {
      this.options.logger.error("StateManager: Failed to sync to local", error);
      throw error;
    }
  }

  /**
   * Sync environment variables from Hestia config
   */
  syncEnvironment(config: HestiaConfig): Record<string, string> {
    const envUpdates: Record<string, string> = {};

    // Hearth configuration
    if (config.hearth.id) {
      envUpdates.HESTIA_HEARTH_ID = config.hearth.id;
    }
    if (config.hearth.name) {
      envUpdates.HESTIA_HEARTH_NAME = config.hearth.name;
    }
    if (config.hearth.role) {
      envUpdates.HESTIA_HEARTH_ROLE = config.hearth.role;
    }
    if (config.hearth.domain) {
      envUpdates.HESTIA_DOMAIN = config.hearth.domain;
    }

    // Intelligence configuration
    if (config.intelligence) {
      envUpdates.HESTIA_INTELLIGENCE_PROVIDER = config.intelligence.provider;
      envUpdates.HESTIA_INTELLIGENCE_MODEL = config.intelligence.model;

      if (config.intelligence.endpoint) {
        envUpdates.HESTIA_INTELLIGENCE_ENDPOINT = config.intelligence.endpoint;
      }
      if (config.intelligence.apiKey) {
        envUpdates.HESTIA_INTELLIGENCE_API_KEY = config.intelligence.apiKey;
      }
    }

    // Pod configuration
    if (config.pod) {
      if (config.pod.url) {
        envUpdates.HESTIA_POD_URL = config.pod.url;
      }
      if (config.pod.apiKey) {
        envUpdates.HESTIA_API_KEY = config.pod.apiKey;
      }
      if (config.pod.workspaceId) {
        envUpdates.HESTIA_WORKSPACE_ID = config.pod.workspaceId;
      }
    }

    // Apply environment updates
    for (const [key, value] of Object.entries(envUpdates)) {
      this.setEnvVar(key, value);
    }

    this.options.logger.debug("StateManager: Synced environment variables", Object.keys(envUpdates));
    return envUpdates;
  }

  /**
   * Get sync status for health checks
   * Returns the current sync state without triggering a sync
   */
  async getSyncStatus(): Promise<{
    lastSync: string | null;
    pendingChanges: number;
    conflicts: number;
    isSyncing: boolean;
  }> {
    // Check if we have OpenClaude/OpenClaw configs
    const [openclaude, openclaw] = await Promise.all([
      this.openClaudeSync.loadProfile().catch(() => null),
      this.openClawSync.loadConfig().catch(() => null),
    ]);

    // Determine last sync time from configs
    const lastSync = openclaude?.lastSynced ?? openclaw?.lastSynced ?? null;

    return {
      lastSync,
      pendingChanges: 0, // Would require comparing states to calculate
      conflicts: 0,      // Would require conflict detection to calculate
      isSyncing: this.isSyncing,
    };
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  /**
   * Get comprehensive state summary
   */
  async getStateSummary(): Promise<{
    normal: NormalState;
    local: LocalState;
    runtime: RuntimeState;
    syncStatus: {
      isSyncing: boolean;
      autoSyncEnabled: boolean;
    };
  }> {
    const [normal, local] = await Promise.all([
      this.getNormalState(),
      this.getLocalState(),
    ]);

    return {
      normal,
      local,
      runtime: this.getRuntimeState(),
      syncStatus: {
        isSyncing: this.isSyncing,
        autoSyncEnabled: this.options.autoSync,
      },
    };
  }

  /**
   * Reset all state and clear caches
   */
  async reset(): Promise<void> {
    this.runtimeState.memory.clear();
    this.runtimeState.environment = { ...process.env };
    this.runtimeState.timestamp = new Date();
    this.options.logger.info("StateManager: State reset");
  }

  /**
   * Get underlying services (for advanced usage)
   */
  getServices(): {
    config: ConfigService;
    openClaude: OpenClaudeSync;
    openClaw: OpenClawSync;
    api: APIService;
  } {
    return {
      config: this.configService,
      openClaude: this.openClaudeSync,
      openClaw: this.openClawSync,
      api: this.apiService,
    };
  }
}

// ============================================================================
// Error Types (for backward compatibility)
// ============================================================================

export class StateManagerError extends Error {
  constructor(
    message: string,
    public code: string,
    public cause?: unknown
  ) {
    super(message);
    this.name = "StateManagerError";
  }
}

// ============================================================================
// Singleton Instance (for backward compatibility)
// ============================================================================

/**
 * Global singleton instance of the StateManager
 */
export const stateManager = new StateManager();

/**
 * Initialize the global state manager
 */
export async function initializeStateManager(config?: { baseUrl?: string; apiKey?: string }): Promise<void> {
  await stateManager.initialize(config);
}

/**
 * Shutdown the global state manager
 */
export async function shutdownStateManager(): Promise<void> {
  await stateManager.shutdown();
}

// Default export for convenience
export default stateManager;
