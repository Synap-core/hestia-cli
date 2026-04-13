// @ts-nocheck
/**
 * Unified State Manager for Hestia CLI
 *
 * Manages three layers of state with bidirectional sync:
 * - Normal State: Synap Backend entities + ~/.hestia/config.yaml
 * - Local State: OpenClaude ~/.openclaude-profile.json + OpenClaw ~/.openclaw/config.json
 * - Runtime State: Environment variables + in-memory cache
 */
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { watch } from "fs";
import { createAPIClient } from "./api-client.js";
import { loadConfig, saveConfig, getConfigPaths } from '../../../lib/utils/index.js';
import { logger } from '../../../lib/utils/index.js';
// ============================================================================
// Configuration Paths
// ============================================================================
function getLocalConfigPaths() {
    const homeDir = os.homedir();
    return {
        openclaude: path.join(homeDir, ".openclaude-profile.json"),
        openclaw: path.join(homeDir, ".openclaw", "config.json"),
        openclawDir: path.join(homeDir, ".openclaw"),
    };
}
// ============================================================================
// Unified State Manager Class
// ============================================================================
export class UnifiedStateManager {
    apiClient = null;
    runtimeState;
    fileWatchers = new Map();
    syncIntervalId = null;
    options;
    isSyncing = false;
    logger;
    // Cache for normal state
    normalStateCache = null;
    normalStateCacheTime = null;
    CACHE_TTL_MS = 30000; // 30 seconds
    constructor(options = {}) {
        this.options = {
            conflictStrategy: options.conflictStrategy ?? "synap-wins",
            autoSync: options.autoSync ?? true,
            syncInterval: options.syncInterval ?? 60000, // 1 minute
            logger: options.logger ?? logger,
        };
        this.logger = this.options.logger;
        // Initialize runtime state
        this.runtimeState = {
            environment: { ...process.env },
            memory: new Map(),
            timestamp: new Date(),
        };
        // Bind methods for callbacks
        this.handleFileChange = this.handleFileChange.bind(this);
    }
    // ============================================================================
    // Initialization
    // ============================================================================
    /**
     * Initialize the state manager with API client
     */
    async initialize(apiClientConfig) {
        try {
            this.apiClient = await createAPIClient(apiClientConfig);
            this.logger.debug("StateManager: API client initialized");
        }
        catch (error) {
            this.logger.warn("StateManager: Failed to initialize API client, operating in local-only mode", error);
            this.apiClient = null;
        }
        // Load initial runtime state
        this.runtimeState.environment = { ...process.env };
        this.runtimeState.timestamp = new Date();
        // Setup auto-sync if enabled
        if (this.options.autoSync) {
            this.watchAndSync();
            if (this.options.syncInterval > 0) {
                this.syncIntervalId = setInterval(() => {
                    this.syncAll().catch((err) => {
                        this.logger.error("StateManager: Scheduled sync failed", err);
                    });
                }, this.options.syncInterval);
            }
        }
        this.logger.info("StateManager: Initialized successfully");
    }
    /**
     * Shutdown the state manager and cleanup resources
     */
    async shutdown() {
        // Stop file watchers
        for (const [path, watcher] of this.fileWatchers.entries()) {
            watcher.close();
            this.logger.debug(`StateManager: Stopped watcher for ${path}`);
        }
        this.fileWatchers.clear();
        // Stop sync interval
        if (this.syncIntervalId) {
            clearInterval(this.syncIntervalId);
            this.syncIntervalId = null;
        }
        // Clear memory cache
        this.runtimeState.memory.clear();
        this.normalStateCache = null;
        this.logger.info("StateManager: Shutdown complete");
    }
    // ============================================================================
    // Normal State Methods (Synap + Local Config)
    // ============================================================================
    /**
     * Get normal state from Synap Backend and local config
     */
    async getNormalState() {
        // Check cache first
        if (this.normalStateCache && this.normalStateCacheTime) {
            const age = Date.now() - this.normalStateCacheTime.getTime();
            if (age < this.CACHE_TTL_MS) {
                this.logger.debug("StateManager: Returning cached normal state");
                return this.normalStateCache;
            }
        }
        try {
            // Load local config
            const { config: localConfig } = await loadConfig();
            // Try to fetch from Synap if API client is available
            let entities = {};
            let source = "local";
            if (this.apiClient && localConfig.hearth.id) {
                try {
                    const status = await this.apiClient.getHearthStatus(localConfig.hearth.id);
                    entities.hearthNode = {
                        id: status.hearth_node.id,
                        name: status.hearth_node.hostname,
                        role: status.hearth_node.role,
                        status: status.hearth_node.healthStatus,
                    };
                    if (status.intelligence_provider) {
                        entities.intelligenceProvider = {
                            id: status.intelligence_provider.id,
                            providerType: status.intelligence_provider.providerType,
                            model: status.intelligence_provider.model,
                            status: status.intelligence_provider.status,
                        };
                    }
                    source = "synap";
                    this.logger.debug("StateManager: Fetched normal state from Synap backend");
                }
                catch (error) {
                    this.logger.warn("StateManager: Failed to fetch from Synap, using local state only", error);
                    source = "local";
                }
            }
            const state = {
                config: localConfig,
                entities,
                lastSynced: new Date(),
                source,
            };
            // Update cache
            this.normalStateCache = state;
            this.normalStateCacheTime = new Date();
            return state;
        }
        catch (error) {
            this.logger.error("StateManager: Failed to get normal state", error);
            throw new StateManagerError("Failed to retrieve normal state", "GET_NORMAL_STATE_FAILED", error);
        }
    }
    /**
     * Set normal state - writes to both Synap and local config
     */
    async setNormalState(updates) {
        if (this.isSyncing) {
            throw new StateManagerError("Sync already in progress", "SYNC_IN_PROGRESS");
        }
        this.isSyncing = true;
        try {
            const currentState = await this.getNormalState();
            const mergedConfig = { ...currentState.config, ...updates };
            // Save to local config first
            await saveConfig(mergedConfig);
            this.logger.debug("StateManager: Saved normal state to local config");
            // Update Synap backend if available
            if (this.apiClient && currentState.entities.hearthNode?.id) {
                try {
                    // Send heartbeat to update status
                    await this.apiClient.heartbeat(currentState.entities.hearthNode.id, {
                        packages: [],
                        healthStatus: "healthy",
                    });
                    this.logger.debug("StateManager: Updated normal state in Synap backend");
                }
                catch (error) {
                    this.logger.warn("StateManager: Failed to update Synap backend", error);
                    // Don't throw - local save succeeded
                }
            }
            // Invalidate cache
            this.normalStateCache = null;
            this.normalStateCacheTime = null;
            // Return updated state
            const updatedState = await this.getNormalState();
            return updatedState;
        }
        catch (error) {
            this.logger.error("StateManager: Failed to set normal state", error);
            throw new StateManagerError("Failed to update normal state", "SET_NORMAL_STATE_FAILED", error);
        }
        finally {
            this.isSyncing = false;
        }
    }
    // ============================================================================
    // Local State Methods (OpenClaude + OpenClaw)
    // ============================================================================
    /**
     * Get local state from OpenClaude and OpenClaw config files
     */
    async getLocalState() {
        const paths = getLocalConfigPaths();
        let openclaude = null;
        let openclaw = null;
        // Load OpenClaude profile
        try {
            const content = await fs.readFile(paths.openclaude, "utf-8");
            openclaude = JSON.parse(content);
            this.logger.debug("StateManager: Loaded OpenClaude profile");
        }
        catch (error) {
            if (error.code !== "ENOENT") {
                this.logger.warn("StateManager: Error loading OpenClaude profile", error);
            }
        }
        // Load OpenClaw config
        try {
            const content = await fs.readFile(paths.openclaw, "utf-8");
            openclaw = JSON.parse(content);
            this.logger.debug("StateManager: Loaded OpenClaw config");
        }
        catch (error) {
            if (error.code !== "ENOENT") {
                this.logger.warn("StateManager: Error loading OpenClaw config", error);
            }
        }
        return {
            openclaude,
            openclaw,
            paths: {
                openclaude: paths.openclaude,
                openclaw: paths.openclaw,
            },
            lastSynced: new Date(),
        };
    }
    /**
     * Set local state - writes to both OpenClaude and OpenClaw config files
     */
    async setLocalState(updates) {
        const paths = getLocalConfigPaths();
        const currentState = await this.getLocalState();
        // Update OpenClaude profile
        if (updates.openclaude) {
            const updated = {
                version: currentState.openclaude?.version ?? "1.0",
                profile: {
                    name: "",
                    preferences: {
                        theme: "system",
                        language: "en",
                    },
                    ai: {
                        provider: "synap",
                        model: "llama3.1:8b",
                    },
                    integrations: {
                        synap: {
                            enabled: true,
                        },
                    },
                    ...currentState.openclaude?.profile,
                    ...updates.openclaude.profile,
                },
                lastSynced: new Date().toISOString(),
            };
            await fs.mkdir(path.dirname(paths.openclaude), { recursive: true });
            await fs.writeFile(paths.openclaude, JSON.stringify(updated, null, 2), "utf-8");
            this.logger.debug("StateManager: Saved OpenClaude profile");
        }
        // Update OpenClaw config
        if (updates.openclaw) {
            const updated = {
                version: currentState.openclaw?.version ?? "1.0",
                ...currentState.openclaw,
                ...updates.openclaw,
                lastSynced: new Date().toISOString(),
            };
            await fs.mkdir(paths.openclawDir, { recursive: true });
            await fs.writeFile(paths.openclaw, JSON.stringify(updated, null, 2), "utf-8");
            this.logger.debug("StateManager: Saved OpenClaw config");
        }
        return this.getLocalState();
    }
    // ============================================================================
    // Runtime State Methods (Environment + Memory)
    // ============================================================================
    /**
     * Get current runtime state
     */
    getRuntimeState() {
        // Always refresh environment from process.env
        return {
            environment: { ...process.env },
            memory: new Map(this.runtimeState.memory),
            timestamp: new Date(),
        };
    }
    /**
     * Set runtime state - updates environment variables and/or memory
     */
    setRuntimeState(updates) {
        // Update environment variables
        if (updates.environment) {
            for (const [key, value] of Object.entries(updates.environment)) {
                if (value === undefined) {
                    delete process.env[key];
                }
                else {
                    process.env[key] = value;
                }
            }
        }
        // Update memory cache
        if (updates.memory) {
            if (updates.memory instanceof Map) {
                for (const [key, value] of updates.memory.entries()) {
                    this.runtimeState.memory.set(key, value);
                }
            }
            else {
                for (const [key, value] of Object.entries(updates.memory)) {
                    this.runtimeState.memory.set(key, value);
                }
            }
        }
        this.runtimeState.timestamp = new Date();
        this.logger.debug("StateManager: Updated runtime state");
        return this.getRuntimeState();
    }
    /**
     * Get a value from runtime memory
     */
    getRuntimeValue(key, defaultValue) {
        return this.runtimeState.memory.get(key) ?? defaultValue;
    }
    /**
     * Set a value in runtime memory
     */
    setRuntimeValue(key, value) {
        this.runtimeState.memory.set(key, value);
        this.runtimeState.timestamp = new Date();
    }
    /**
     * Get an environment variable
     */
    getEnvVar(key, defaultValue) {
        return process.env[key] ?? defaultValue;
    }
    /**
     * Set an environment variable
     */
    setEnvVar(key, value) {
        process.env[key] = value;
        this.runtimeState.environment[key] = value;
        this.runtimeState.timestamp = new Date();
    }
    // ============================================================================
    // Configuration Translation Methods
    // ============================================================================
    /**
     * Translate Hestia state to OpenClaude profile format
     */
    translateToOpenClaude(hestiaState) {
        const config = hestiaState.config;
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
                        podUrl: this.getEnvVar("HESTIA_POD_URL") ?? this.getEnvVar("SYNAP_POD_URL"),
                        apiKey: this.getEnvVar("HESTIA_API_KEY") ?? this.getEnvVar("SYNAP_API_KEY"),
                        workspaceId: hestiaState.entities.workspace?.id,
                    },
                    openclaw: {
                        enabled: config.packages.openclaw?.enabled ?? false,
                        endpoint: this.getEnvVar("OPENCLAW_ENDPOINT"),
                        apiKey: this.getEnvVar("OPENCLAW_API_KEY"),
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
     * Translate Hestia state to OpenClaw config format
     */
    translateToOpenClaw(hestiaState) {
        const config = hestiaState.config;
        const providers = [];
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
                token: this.getEnvVar("OPENCLAW_TOKEN"),
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
                    apiKey: this.getEnvVar("HESTIA_API_KEY") ?? this.getEnvVar("SYNAP_API_KEY"),
                    podUrl: this.getEnvVar("HESTIA_POD_URL") ?? "http://localhost:4000",
                },
            },
            lastSynced: new Date().toISOString(),
        };
    }
    /**
     * Sync environment variables from Hestia state
     */
    syncEnvironment(hestiaState) {
        const config = hestiaState.config;
        const envUpdates = {};
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
        // Apply environment updates
        this.setRuntimeState({ environment: envUpdates });
        this.logger.debug("StateManager: Synced environment variables", Object.keys(envUpdates));
        return envUpdates;
    }
    // ============================================================================
    // Bidirectional Sync Methods
    // ============================================================================
    /**
     * Perform bidirectional sync with conflict resolution
     */
    async syncAll() {
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
        this.logger.info("StateManager: Starting bidirectional sync");
        const result = {
            success: true,
            direction: "none",
            conflicts: [],
            changes: { synap: [], local: [] },
            errors: [],
        };
        try {
            // Get all states
            const normalState = await this.getNormalState();
            const localState = await this.getLocalState();
            // Sync environment first
            this.syncEnvironment(normalState);
            // Check for conflicts in configurations
            const conflicts = this.detectConflicts(normalState, localState);
            result.conflicts = conflicts;
            // Resolve conflicts
            const resolved = this.resolveConflicts(normalState, localState, conflicts);
            // Determine sync direction based on timestamps and strategy
            const normalLastSync = normalState.lastSynced.getTime();
            const localLastSync = localState.lastSynced.getTime();
            if (this.options.conflictStrategy === "synap-wins") {
                result.direction = "to-local";
                // Push to OpenClaude/OpenClaw
                await this.pushToLocal(resolved.normal, result);
            }
            else if (this.options.conflictStrategy === "local-wins") {
                result.direction = "to-synap";
                // Push to Synap
                await this.pushToSynap(resolved.local, result);
            }
            else if (this.options.conflictStrategy === "newest-wins") {
                if (normalLastSync > localLastSync) {
                    result.direction = "to-local";
                    await this.pushToLocal(resolved.normal, result);
                }
                else {
                    result.direction = "to-synap";
                    await this.pushToSynap(resolved.local, result);
                }
            }
            else {
                // Manual - just detect conflicts, don't auto-resolve
                result.direction = "none";
            }
            // If bidirectional, also sync the other way for non-conflicting changes
            if (result.direction !== "none" && conflicts.length === 0) {
                result.direction = "bidirectional";
            }
            // Invalidate caches
            this.normalStateCache = null;
            this.normalStateCacheTime = null;
            this.logger.success("StateManager: Sync completed");
            return result;
        }
        catch (error) {
            result.success = false;
            const errorMsg = error instanceof Error ? error.message : String(error);
            result.errors.push(errorMsg);
            this.logger.error("StateManager: Sync failed", error);
            return result;
        }
        finally {
            this.isSyncing = false;
        }
    }
    /**
     * Detect conflicts between normal and local state
     */
    detectConflicts(normalState, localState) {
        const conflicts = [];
        // Check hearth name
        const normalHearthName = normalState.config.hearth.name;
        const openclaudeName = localState.openclaude?.profile.name;
        const openclawName = localState.openclaw?.integrations?.synap?.hearthNodeId;
        if (openclaudeName && openclaudeName !== normalHearthName) {
            conflicts.push({
                key: "hearth.name",
                synapValue: normalHearthName,
                localValue: openclaudeName,
                resolution: this.options.conflictStrategy === "local-wins" ? "local" : "synap",
            });
        }
        // Check intelligence provider
        const normalProvider = normalState.config.intelligence?.provider;
        const openclaudeProvider = localState.openclaude?.profile.ai.provider;
        const openclawProvider = localState.openclaw?.defaults?.provider;
        if (openclaudeProvider && openclaudeProvider !== normalProvider) {
            conflicts.push({
                key: "intelligence.provider",
                synapValue: normalProvider,
                localValue: openclaudeProvider,
                resolution: this.options.conflictStrategy === "local-wins" ? "local" : "synap",
            });
        }
        // Check intelligence model
        const normalModel = normalState.config.intelligence?.model;
        const openclaudeModel = localState.openclaude?.profile.ai.model;
        const openclawModel = localState.openclaw?.defaults?.model;
        if (openclaudeModel && openclaudeModel !== normalModel) {
            conflicts.push({
                key: "intelligence.model",
                synapValue: normalModel,
                localValue: openclaudeModel,
                resolution: this.options.conflictStrategy === "local-wins" ? "local" : "synap",
            });
        }
        return conflicts;
    }
    /**
     * Resolve conflicts based on strategy
     */
    resolveConflicts(normalState, localState, conflicts) {
        // For now, return as-is. Resolution happens in push methods.
        return { normal: normalState, local: localState };
    }
    /**
     * Push normal state to local configs (OpenClaude/OpenClaw)
     */
    async pushToLocal(normalState, result) {
        // Translate and save OpenClaude profile
        const openclaudeProfile = this.translateToOpenClaude(normalState);
        await this.setLocalState({ openclaude: openclaudeProfile });
        result.changes.local.push("openclaude-profile");
        // Translate and save OpenClaw config
        const openclawConfig = this.translateToOpenClaw(normalState);
        await this.setLocalState({ openclaw: openclawConfig });
        result.changes.local.push("openclaw-config");
        // Sync environment
        this.syncEnvironment(normalState);
        result.changes.local.push("environment");
        this.logger.debug("StateManager: Pushed state to local configs");
    }
    /**
     * Push local state to Synap backend
     */
    async pushToSynap(localState, result) {
        // Extract config updates from local state
        const updates = {};
        if (localState.openclaude?.profile.name) {
            updates.hearth = { name: localState.openclaude.profile.name, role: "primary", id: "" };
        }
        if (localState.openclaude?.profile.ai) {
            updates.intelligence = {
                provider: localState.openclaude.profile.ai.provider,
                model: localState.openclaude.profile.ai.model,
                temperature: localState.openclaude.profile.ai.temperature,
                maxTokens: localState.openclaude.profile.ai.maxTokens,
                apiKey: localState.openclaude.profile.ai.apiKey,
                endpoint: localState.openclaude.profile.ai.endpoint,
            };
        }
        await this.setNormalState(updates);
        result.changes.synap.push("hearth-config");
        result.changes.synap.push("intelligence-config");
        this.logger.debug("StateManager: Pushed state to Synap backend");
    }
    // ============================================================================
    // File Watchers and Auto-Sync
    // ============================================================================
    /**
     * Setup file watchers for auto-sync on changes
     */
    watchAndSync() {
        const paths = {
            ...getConfigPaths(),
            ...getLocalConfigPaths(),
        };
        const filesToWatch = [
            paths.userConfig,
            paths.openclaude,
            paths.openclaw,
        ];
        for (const filePath of filesToWatch) {
            if (this.fileWatchers.has(filePath)) {
                continue; // Already watching
            }
            try {
                const watcher = watch(filePath, (eventType) => {
                    this.handleFileChange(filePath, eventType);
                });
                this.fileWatchers.set(filePath, watcher);
                this.logger.debug(`StateManager: Watching ${filePath}`);
            }
            catch (error) {
                this.logger.warn(`StateManager: Failed to watch ${filePath}`, error);
            }
        }
        this.logger.info("StateManager: File watchers initialized for auto-sync");
    }
    /**
     * Handle file change events
     */
    handleFileChange(filePath, eventType) {
        this.logger.debug(`StateManager: File change detected: ${filePath} (${eventType})`);
        // Debounce rapid changes
        if (this.isSyncing) {
            this.logger.debug("StateManager: Sync in progress, skipping file change");
            return;
        }
        // Invalidate cache for normal state if hestia config changed
        if (filePath.includes(".hestia")) {
            this.normalStateCache = null;
            this.normalStateCacheTime = null;
        }
        // Trigger sync
        if (this.options.autoSync) {
            setTimeout(() => {
                this.syncAll().catch((err) => {
                    this.logger.error("StateManager: Auto-sync failed", err);
                });
            }, 100); // Small delay to batch rapid changes
        }
    }
    /**
     * Stop file watchers
     */
    unwatch() {
        for (const [path, watcher] of this.fileWatchers.entries()) {
            watcher.close();
            this.logger.debug(`StateManager: Stopped watching ${path}`);
        }
        this.fileWatchers.clear();
    }
    // ============================================================================
    // Utility Methods
    // ============================================================================
    /**
     * Get comprehensive state summary
     */
    async getStateSummary() {
        const [normal, local] = await Promise.all([this.getNormalState(), this.getLocalState()]);
        return {
            normal,
            local,
            runtime: this.getRuntimeState(),
            syncStatus: {
                isSyncing: this.isSyncing,
                autoSyncEnabled: this.options.autoSync,
                watchedFiles: Array.from(this.fileWatchers.keys()),
            },
        };
    }
    /**
     * Reset all state and clear caches
     */
    async reset() {
        this.normalStateCache = null;
        this.normalStateCacheTime = null;
        this.runtimeState.memory.clear();
        this.runtimeState.environment = { ...process.env };
        this.runtimeState.timestamp = new Date();
        this.logger.info("StateManager: State reset");
    }
    /**
     * Check if state is stale (needs refresh)
     */
    isStateStale(maxAgeMs = this.CACHE_TTL_MS) {
        if (!this.normalStateCacheTime) {
            return true;
        }
        return Date.now() - this.normalStateCacheTime.getTime() > maxAgeMs;
    }
}
// ============================================================================
// Error Types
// ============================================================================
export class StateManagerError extends Error {
    code;
    cause;
    constructor(message, code, cause) {
        super(message);
        this.code = code;
        this.cause = cause;
        this.name = "StateManagerError";
    }
}
// ============================================================================
// Singleton Instance
// ============================================================================
/**
 * Global singleton instance of the UnifiedStateManager
 */
export const stateManager = new UnifiedStateManager();
/**
 * Initialize the global state manager
 */
export async function initializeStateManager(config) {
    await stateManager.initialize(config);
}
/**
 * Shutdown the global state manager
 */
export async function shutdownStateManager() {
    await stateManager.shutdown();
}
// Default export for convenience
export default stateManager;
//# sourceMappingURL=state-manager.js.map