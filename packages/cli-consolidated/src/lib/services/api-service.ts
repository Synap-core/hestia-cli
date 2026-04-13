/**
 * API Service
 * 
 * Synap backend API client wrapper
 * Provides high-level operations for Hestia state synchronization
 */

import { APIClient, createAPIClient as createBaseClient } from '../domains/shared/lib/api-client.js';
import { logger } from '../utils/logger.js';
import type { HestiaConfig } from './config-service.js';

// Re-export types
export type { APIClient };

/**
 * Hearth node entity (from Synap backend)
 */
export interface HearthNode {
  id: string;
  hostname: string;
  role: "primary" | "backup";
  healthStatus: string;
  lastHeartbeat?: string;
  installMode?: string;
}

/**
 * Intelligence provider entity
 */
export interface IntelligenceProvider {
  id: string;
  providerType: string;
  model: string;
  status: string;
  endpointUrl?: string;
}

/**
 * Package instance entity
 */
export interface PackageInstance {
  id: string;
  packageName: string;
  version?: string;
  status: string;
}

/**
 * API Service configuration
 */
export interface APIServiceConfig {
  baseUrl: string;
  apiKey: string;
  workspaceId: string;
  timeout?: number;
}

/**
 * Normal state - represents the state from Synap backend
 */
export interface NormalState {
  config: HestiaConfig;
  entities: {
    hearthNode?: HearthNode;
    workspace?: {
      id: string;
      name: string;
    };
    intelligenceProvider?: IntelligenceProvider;
    packages?: PackageInstance[];
  };
  lastSynced: Date;
  source: "synap" | "local" | "merged";
}

/**
 * API Service
 * Wraps the Synap backend API client with Hestia-specific operations
 */
export class APIService {
  private client: APIClient | null = null;
  private config: APIServiceConfig | null = null;

  /**
   * Initialize the API service with configuration
   */
  async initialize(config?: Partial<APIServiceConfig>): Promise<void> {
    // Try to get config from environment or parameters
    const baseUrl = config?.baseUrl || process.env.HESTIA_POD_URL || process.env.SYNAP_POD_URL;
    const apiKey = config?.apiKey || process.env.HESTIA_API_KEY || process.env.SYNAP_API_KEY;
    const workspaceId = config?.workspaceId || process.env.HESTIA_WORKSPACE_ID || "default";

    if (!baseUrl || !apiKey) {
      logger.warn("APIService: Missing API configuration, operating in local-only mode");
      this.client = null;
      return;
    }

    this.config = {
      baseUrl,
      apiKey,
      workspaceId,
      timeout: config?.timeout || 30000,
    };

    this.client = await createBaseClient(this.config);
    logger.debug("APIService: API client initialized");
  }

  /**
   * Check if API client is available
   */
  isConnected(): boolean {
    return this.client !== null;
  }

  /**
   * Create API client instance
   */
  async createAPIClient(config: APIServiceConfig): Promise<APIClient> {
    this.config = config;
    this.client = await createBaseClient(config);
    return this.client;
  }

  /**
   * Get current API client
   */
  getClient(): APIClient | null {
    return this.client;
  }

  /**
   * Push Hestia config to Synap backend
   */
  async pushToSynap(config: HestiaConfig): Promise<void> {
    if (!this.client) {
      throw new APIServiceError(
        "API client not initialized",
        "NOT_INITIALIZED"
      );
    }

    if (!config.hearth.id) {
      throw new APIServiceError(
        "Hearth ID required for push",
        "MISSING_HEARTH_ID"
      );
    }

    try {
      // Send heartbeat to update hearth status
      await this.client.heartbeat(config.hearth.id, {
        packages: [],
        healthStatus: "healthy",
      });
      logger.debug("APIService: Pushed config to Synap backend");
    } catch (error) {
      throw new APIServiceError(
        `Failed to push to Synap: ${(error as Error).message}`,
        "PUSH_FAILED",
        error
      );
    }
  }

  /**
   * Pull state from Synap backend
   */
  async pullFromSynap(hearthId?: string): Promise<NormalState> {
    if (!this.client) {
      throw new APIServiceError(
        "API client not initialized",
        "NOT_INITIALIZED"
      );
    }

    const id = hearthId || process.env.HESTIA_HEARTH_ID;
    if (!id) {
      throw new APIServiceError(
        "Hearth ID required for pull",
        "MISSING_HEARTH_ID"
      );
    }

    try {
      const status = await this.client.getHearthStatus(id);
      
      const state: NormalState = {
        config: {} as HestiaConfig, // Will be merged with local
        entities: {
          hearthNode: {
            id: status.hearth_node.id,
            hostname: status.hearth_node.hostname,
            role: status.hearth_node.role,
            healthStatus: status.hearth_node.health_status,
            lastHeartbeat: status.hearth_node.last_heartbeat,
            installMode: status.hearth_node.install_mode,
          },
          packages: status.packages.map(p => ({
            id: p.id,
            packageName: p.packageName,
            version: p.version,
            status: p.status,
          })),
        },
        lastSynced: new Date(),
        source: "synap",
      };

      if (status.intelligence_provider) {
        state.entities.intelligenceProvider = {
          id: status.intelligence_provider.id,
          providerType: status.intelligence_provider.providerType,
          model: status.intelligence_provider.model,
          status: status.intelligence_provider.status,
          endpointUrl: status.intelligence_provider.endpoint_url,
        };
      }

      logger.debug("APIService: Pulled state from Synap backend");
      return state;
    } catch (error) {
      throw new APIServiceError(
        `Failed to pull from Synap: ${(error as Error).message}`,
        "PULL_FAILED",
        error
      );
    }
  }

  /**
   * Get hearth status from Synap backend
   */
  async getHearthStatus(hearthId: string): Promise<{
    hearthNode: HearthNode;
    packages: PackageInstance[];
    intelligenceProvider?: IntelligenceProvider;
  }> {
    if (!this.client) {
      throw new APIServiceError(
        "API client not initialized",
        "NOT_INITIALIZED"
      );
    }

    const status = await this.client.getHearthStatus(hearthId);
    
    return {
      hearthNode: {
        id: status.hearth_node.id,
        hostname: status.hearth_node.hostname,
        role: status.hearth_node.role,
        healthStatus: status.hearth_node.health_status,
        lastHeartbeat: status.hearth_node.last_heartbeat,
        installMode: status.hearth_node.install_mode,
      },
      packages: status.packages.map(p => ({
        id: p.id,
        packageName: p.packageName,
        version: p.version,
        status: p.status,
      })),
      intelligenceProvider: status.intelligence_provider ? {
        id: status.intelligence_provider.id,
        providerType: status.intelligence_provider.providerType,
        model: status.intelligence_provider.model,
        status: status.intelligence_provider.status,
      } : undefined,
    };
  }

  /**
   * Send heartbeat to Synap backend
   */
  async sendHeartbeat(
    hearthId: string,
    data: {
      packages: Array<{
        packageName: string;
        version: string;
        status: string;
        config?: Record<string, unknown>;
      }>;
      healthStatus: string;
      resourceUsage?: {
        cpu?: number;
        memory?: number;
        disk?: number;
      };
    }
  ): Promise<void> {
    if (!this.client) {
      throw new APIServiceError(
        "API client not initialized",
        "NOT_INITIALIZED"
      );
    }

    await this.client.heartbeat(hearthId, data);
  }

  /**
   * Register a new hearth node
   */
  async registerHearth(config: {
    hostname: string;
    role: "primary" | "backup";
    ipAddress?: string;
    installMode?: string;
    intelligenceProvider: {
      providerType: string;
      endpointUrl: string;
      apiKeyEnv?: string;
      model: string;
      config?: Record<string, unknown>;
    };
  }): Promise<{
    hearthNode: HearthNode;
    intelligenceProvider: IntelligenceProvider;
  }> {
    if (!this.client) {
      throw new APIServiceError(
        "API client not initialized",
        "NOT_INITIALIZED"
      );
    }

    const result = await this.client.registerHearth({
      hostname: config.hostname,
      role: config.role,
      ipAddress: config.ipAddress || "127.0.0.1",
      installMode: config.installMode || "manual",
      intelligenceProvider: {
        providerType: config.intelligenceProvider.providerType,
        endpointUrl: config.intelligenceProvider.endpointUrl,
        apiKeyEnv: config.intelligenceProvider.apiKeyEnv,
        model: config.intelligenceProvider.model,
        config: config.intelligenceProvider.config,
      },
    });

    return {
      hearthNode: {
        id: result.hearth_node.id,
        hostname: result.hearth_node.hostname,
        role: result.hearth_node.role,
        healthStatus: result.hearth_node.health_status,
      },
      intelligenceProvider: {
        id: result.intelligence_provider.id,
        providerType: result.intelligence_provider.provider_type,
        model: result.intelligence_provider.model,
        status: result.intelligence_provider.status,
      },
    };
  }
}

/**
 * API Service Error
 */
export class APIServiceError extends Error {
  constructor(
    message: string,
    public code: string,
    public cause?: unknown
  ) {
    super(message);
    this.name = "APIServiceError";
  }
}

// Singleton instance for convenience
export const apiService = new APIService();

// Backward-compatible factory function
export async function createAPIClient(config: {
  baseUrl?: string;
  apiKey?: string;
  workspaceId?: string;
}): Promise<APIClient> {
  await apiService.initialize({
    baseUrl: config.baseUrl || "",
    apiKey: config.apiKey || "",
    workspaceId: config.workspaceId || "default",
  });
  
  const client = apiService.getClient();
  if (!client) {
    throw new APIServiceError(
      "Failed to create API client",
      "CREATION_FAILED"
    );
  }
  
  return client;
}
