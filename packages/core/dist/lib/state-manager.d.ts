/**
 * Unified State Manager for Hestia CLI
 *
 * Manages three layers of state with bidirectional sync:
 * - Normal State: Synap Backend entities + ~/.hestia/config.yaml
 * - Local State: OpenClaude ~/.openclaude-profile.json + OpenClaw ~/.openclaw/config.json
 * - Runtime State: Environment variables + in-memory cache
 */
import { HestiaConfig } from "./config.js";
import { logger } from "./logger.js";
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
 * Normal state - Synap backend + local config
 */
export interface NormalState {
    config: HestiaConfig;
    entities: {
        hearthNode?: {
            id: string;
            name: string;
            role: string;
            status: string;
        };
        workspace?: {
            id: string;
            name: string;
        };
        intelligenceProvider?: {
            id: string;
            providerType: string;
            model: string;
            status: string;
        };
    };
    lastSynced: Date;
    source: "synap" | "local" | "merged";
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
 * Runtime state - Environment + memory
 */
export interface RuntimeState {
    environment: Record<string, string | undefined>;
    memory: Map<string, unknown>;
    timestamp: Date;
}
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
}
export declare class UnifiedStateManager {
    private apiClient;
    private runtimeState;
    private fileWatchers;
    private syncIntervalId;
    private options;
    private isSyncing;
    private logger;
    private normalStateCache;
    private normalStateCacheTime;
    private readonly CACHE_TTL_MS;
    constructor(options?: StateManagerOptions);
    /**
     * Initialize the state manager with API client
     */
    initialize(apiClientConfig?: {
        baseUrl?: string;
        apiKey?: string;
    }): Promise<void>;
    /**
     * Shutdown the state manager and cleanup resources
     */
    shutdown(): Promise<void>;
    /**
     * Get normal state from Synap Backend and local config
     */
    getNormalState(): Promise<NormalState>;
    /**
     * Set normal state - writes to both Synap and local config
     */
    setNormalState(updates: Partial<HestiaConfig>): Promise<NormalState>;
    /**
     * Get local state from OpenClaude and OpenClaw config files
     */
    getLocalState(): Promise<LocalState>;
    /**
     * Set local state - writes to both OpenClaude and OpenClaw config files
     */
    setLocalState(updates: {
        openclaude?: Partial<OpenClaudeProfile>;
        openclaw?: Partial<OpenClawConfig>;
    }): Promise<LocalState>;
    /**
     * Get current runtime state
     */
    getRuntimeState(): RuntimeState;
    /**
     * Set runtime state - updates environment variables and/or memory
     */
    setRuntimeState(updates: {
        environment?: Record<string, string | undefined>;
        memory?: Map<string, unknown> | Record<string, unknown>;
    }): RuntimeState;
    /**
     * Get a value from runtime memory
     */
    getRuntimeValue<T>(key: string, defaultValue?: T): T | undefined;
    /**
     * Set a value in runtime memory
     */
    setRuntimeValue<T>(key: string, value: T): void;
    /**
     * Get an environment variable
     */
    getEnvVar(key: string, defaultValue?: string): string | undefined;
    /**
     * Set an environment variable
     */
    setEnvVar(key: string, value: string): void;
    /**
     * Translate Hestia state to OpenClaude profile format
     */
    translateToOpenClaude(hestiaState: NormalState): OpenClaudeProfile;
    /**
     * Translate Hestia state to OpenClaw config format
     */
    translateToOpenClaw(hestiaState: NormalState): OpenClawConfig;
    /**
     * Sync environment variables from Hestia state
     */
    syncEnvironment(hestiaState: NormalState): Record<string, string>;
    /**
     * Perform bidirectional sync with conflict resolution
     */
    syncAll(): Promise<SyncResult>;
    /**
     * Detect conflicts between normal and local state
     */
    private detectConflicts;
    /**
     * Resolve conflicts based on strategy
     */
    private resolveConflicts;
    /**
     * Push normal state to local configs (OpenClaude/OpenClaw)
     */
    private pushToLocal;
    /**
     * Push local state to Synap backend
     */
    private pushToSynap;
    /**
     * Setup file watchers for auto-sync on changes
     */
    watchAndSync(): void;
    /**
     * Handle file change events
     */
    private handleFileChange;
    /**
     * Stop file watchers
     */
    unwatch(): void;
    /**
     * Get comprehensive state summary
     */
    getStateSummary(): Promise<{
        normal: NormalState;
        local: LocalState;
        runtime: RuntimeState;
        syncStatus: {
            isSyncing: boolean;
            autoSyncEnabled: boolean;
            watchedFiles: string[];
        };
    }>;
    /**
     * Reset all state and clear caches
     */
    reset(): Promise<void>;
    /**
     * Check if state is stale (needs refresh)
     */
    isStateStale(maxAgeMs?: number): boolean;
}
export declare class StateManagerError extends Error {
    code: string;
    cause?: unknown | undefined;
    constructor(message: string, code: string, cause?: unknown | undefined);
}
/**
 * Global singleton instance of the UnifiedStateManager
 */
export declare const stateManager: UnifiedStateManager;
/**
 * Initialize the global state manager
 */
export declare function initializeStateManager(config?: {
    baseUrl?: string;
    apiKey?: string;
}): Promise<void>;
/**
 * Shutdown the global state manager
 */
export declare function shutdownStateManager(): Promise<void>;
export default stateManager;
//# sourceMappingURL=state-manager.d.ts.map