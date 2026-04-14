import { z } from 'zod';

/**
 * DNA Types - Core type definitions for Eve entity state and configuration
 *
 * This file defines the complete type system for the Eve entity architecture,
 * including organs, services, configuration, and state management.
 */
/** Represents the health/availability state of an organ */
type OrganState = 'missing' | 'installing' | 'ready' | 'error' | 'stopped';
/** The available organs in the Eve ecosystem */
type Organ = 'brain' | 'arms' | 'builder' | 'eyes' | 'legs';
/** The state of a single organ */
interface OrganStatus {
    state: OrganState;
    installedAt?: string;
    version?: string;
    lastChecked?: string;
    errorMessage?: string;
}
/** Individual organ configuration */
interface OrganConfig {
    enabled: boolean;
    autoStart: boolean;
    port?: number;
    environment?: Record<string, string>;
}
/** Available services organized by organ */
type BrainService = 'synap' | 'ollama' | 'postgres' | 'redis';
type ArmsService = 'openclaw';
type BuilderService = 'opencode' | 'openclaude' | 'dokploy';
type EyesService = 'rsshub';
type LegsService = 'traefik' | 'cloudflared' | 'pangolin';
type Service = BrainService | ArmsService | BuilderService | EyesService | LegsService;
/** Service configuration for Docker containers */
interface ServiceConfig {
    /** Docker image name */
    image: string;
    /** Container name (following eve-{organ}-{service} convention) */
    containerName: string;
    /** Exposed ports (host:container) */
    ports?: string[];
    /** Environment variables */
    environment?: Record<string, string>;
    /** Volume mounts (host:container) */
    volumes?: string[];
    /** Docker network name */
    network: string;
    /** Restart policy */
    restart?: 'no' | 'always' | 'unless-stopped' | 'on-failure';
    /** Health check command */
    healthCheck?: {
        command: string;
        interval: string;
        timeout: string;
        retries: number;
    };
    /** Command override */
    command?: string[];
    /** Entrypoint override */
    entrypoint?: string;
    /** Dependencies that must be healthy before starting */
    dependsOn?: string[];
}
/** Docker Compose service definition */
interface DockerComposeService {
    image: string;
    container_name: string;
    ports?: string[];
    environment?: Record<string, string>;
    volumes?: string[];
    networks?: string[];
    restart?: string;
    command?: string | string[];
    depends_on?: string[] | Record<string, {
        condition: string;
    }>;
    healthcheck?: {
        test: string[];
        interval: string;
        timeout: string;
        retries: number;
    };
}
/** Docker Compose network definition */
interface DockerComposeNetwork {
    driver: string;
    ipam?: {
        config: Array<{
            subnet: string;
        }>;
    };
}
/** Docker Compose volume definition */
interface DockerComposeVolume {
    driver?: string;
}
/** Complete Docker Compose file structure */
interface DockerCompose {
    version: string;
    services: Record<string, DockerComposeService>;
    networks: Record<string, DockerComposeNetwork>;
    volumes: Record<string, DockerComposeVolume>;
}
/** AI model preference */
type AIModel = 'ollama' | 'none';
/** The complete state of the Eve entity */
interface EntityState {
    version: string;
    initializedAt: string;
    aiModel: AIModel;
    organs: Record<Organ, OrganStatus>;
    metadata: {
        lastBootTime?: string;
        hostname?: string;
        platform?: string;
        arch?: string;
        entityName?: string;
    };
}
/** Complete Eve configuration structure */
interface EveConfig {
    /** The name of this Eve entity */
    name: string;
    /** Entity version */
    version: string;
    /** AI model preference */
    aiModel: AIModel;
    /** Organ-specific configurations */
    organs: Record<Organ, OrganConfig>;
    /** Global settings */
    settings: {
        /** Log level for all organs */
        logLevel: 'debug' | 'info' | 'warn' | 'error';
        /** Whether to check for updates automatically */
        autoUpdate: boolean;
        /** Default timeout for organ operations in ms */
        defaultTimeout: number;
        /** Domain configuration */
        domain?: {
            name: string;
            email: string;
            ssl: boolean;
        };
        /** Network configuration */
        network?: {
            name: string;
            subnet?: string;
        };
    };
    /** Timestamps */
    createdAt: Date;
    updatedAt: Date;
}
/** Stored credentials structure */
interface Credentials {
    /** API keys and tokens */
    [key: string]: string;
}
/** DNA package error with code */
interface DNAError extends Error {
    code?: string;
    path?: string;
    service?: string;
    organ?: Organ;
}

/**
 * Configuration Manager - Handles eve configuration persistence
 */

/** Manages eve configuration loading and saving */
declare class ConfigManager {
    private config;
    /**
     * Get the path to the configuration directory
     */
    getConfigDir(): string;
    /**
     * Get the full path to the configuration file
     */
    getConfigPath(): string;
    /**
     * Ensure the configuration directory exists
     */
    private ensureConfigDir;
    /**
     * Load configuration from disk
     * Creates default config if none exists
     */
    loadConfig(): Promise<EveConfig>;
    /**
     * Create a new default configuration
     */
    createDefaultConfig(name: string): Promise<EveConfig>;
    /**
     * Save configuration to disk
     */
    saveConfig(config: EveConfig): Promise<void>;
    /**
     * Update configuration with partial updates
     */
    updateConfig(updates: Partial<EveConfig>): Promise<EveConfig>;
    /**
     * Get current config without reloading
     */
    getCachedConfig(): EveConfig | null;
}
/** Singleton instance */
declare const configManager: ConfigManager;

/**
 * Credentials Manager - Handles secure storage of API keys and tokens
 */

/** Manages secure storage of credentials */
declare class CredentialsManager {
    private credentials;
    private credentialsPath;
    /**
     * Get the path to the credentials file
     */
    getCredentialsPath(): string;
    /**
     * Set a custom credentials path (useful for testing)
     */
    setCredentialsPath(path: string): void;
    /**
     * Ensure the credentials directory exists with proper permissions
     */
    private ensureCredentialsDir;
    /**
     * Load credentials from disk
     * Returns empty object if no credentials exist
     */
    loadCredentials(): Promise<Credentials>;
    /**
     * Save credentials to disk with restricted permissions
     */
    saveCredentials(creds: Credentials): Promise<void>;
    /**
     * Get a single credential by key
     */
    getCredential(key: string): Promise<string | undefined>;
    /**
     * Set a single credential
     */
    setCredential(key: string, value: string): Promise<void>;
    /**
     * Delete a single credential
     */
    deleteCredential(key: string): Promise<void>;
    /**
     * Check if a credential exists
     */
    hasCredential(key: string): Promise<boolean>;
    /**
     * List all credential keys (values are hidden)
     */
    listCredentialKeys(): Promise<string[]>;
    /**
     * Clear all credentials (use with caution!)
     */
    clearAll(): Promise<void>;
    /**
     * Get cached credentials without reloading
     */
    getCachedCredentials(): Credentials | null;
}
/** Singleton instance */
declare const credentialsManager: CredentialsManager;

/**
 * Entity State Manager
 *
 * Manages the state of the Hestia entity, including organ health,
 * installation status, and completeness tracking.
 * State is stored as JSON in ~/.local/share/hestia/state.json
 */

declare class EntityStateManager {
    private state;
    private statePath;
    private getStatePath;
    getState(): Promise<EntityState>;
    saveState(state: EntityState): Promise<void>;
    updateOrgan(organ: Organ, organState: OrganState, options?: {
        version?: string;
        errorMessage?: string;
    }): Promise<void>;
    setAIModel(model: AIModel): Promise<void>;
    getOrganState(organ: Organ): Promise<OrganStatus>;
    isOrganReady(organ: Organ): Promise<boolean>;
    getReadyOrgans(): Promise<Organ[]>;
    getMissingOrgans(): Promise<Organ[]>;
    getErrorOrgans(): Promise<Organ[]>;
    calculateCompleteness(state: EntityState): number;
    getCompleteness(): Promise<number>;
    getNextSteps(): Promise<string[]>;
    updateMetadata(updates: Partial<EntityState['metadata']>): Promise<void>;
    recordBoot(): Promise<void>;
    resetState(): Promise<void>;
    private createDefaultState;
}
declare const entityStateManager: EntityStateManager;

/**
 * Docker Compose Generator
 *
 * Programmatically generates docker-compose.yml files for eve services.
 * Uses SERVICE_REGISTRY as the source of truth for service configurations.
 *
 * @example
 * ```typescript
 * const generator = new DockerComposeGenerator();
 * generator.addBrainServices();
 * generator.addArmsServices();
 * generator.setEnvVar('JWT_SECRET', 'my-secret');
 * await generator.toFile('./docker-compose.yml');
 * ```
 */

/**
 * Generator for creating docker-compose.yml files
 */
declare class DockerComposeGenerator {
    private services;
    private envVars;
    private volumes;
    /**
     * Add a single service to the docker-compose configuration
     *
     * @param service - The service identifier from SERVICE_REGISTRY
     * @param config - Optional partial configuration to override defaults
     */
    addService(service: Service, config?: Partial<ServiceConfig>): void;
    /**
     * Add all brain services: synap, ollama, postgres, redis
     */
    addBrainServices(): void;
    /**
     * Add arms services: openclaw
     */
    addArmsServices(): void;
    /**
     * Add eyes services: rsshub
     */
    addEyesServices(): void;
    /**
     * Add legs services: traefik
     */
    addLegsServices(): void;
    /**
     * Set an environment variable for substitution
     * Variables will be substituted in the format ${VAR} or $VAR
     *
     * @param key - Environment variable name
     * @param value - Environment variable value
     */
    setEnvVar(key: string, value: string): void;
    /**
     * Set multiple environment variables at once
     *
     * @param vars - Record of environment variables
     */
    setEnvVars(vars: Record<string, string>): void;
    /**
     * Substitute environment variables in a string
     * Replaces ${VAR} or $VAR with the value from envVars or keeps as placeholder
     *
     * @param str - String containing variable placeholders
     * @returns String with variables substituted
     */
    private substituteEnvVars;
    /**
     * Apply environment variable substitution to service configuration
     *
     * @param config - Service configuration
     * @returns Configuration with env vars substituted
     */
    private applyEnvSubstitution;
    /**
     * Convert ServiceConfig to DockerComposeService format
     *
     * @param service - Service identifier
     * @param config - Service configuration
     * @returns DockerComposeService
     */
    private toDockerComposeService;
    /**
     * Generate the complete Docker Compose object
     *
     * @returns DockerCompose object
     */
    generate(): DockerCompose;
    /**
     * Generate YAML string from the docker-compose configuration
     *
     * @returns YAML formatted string
     */
    toYaml(): string;
    /**
     * Write docker-compose.yml to a file
     *
     * @param filePath - Path to write the file
     */
    toFile(filePath: string): Promise<void>;
    /**
     * Check if a service is already added
     *
     * @param service - Service identifier
     * @returns True if service is added
     */
    hasService(service: Service): boolean;
    /**
     * Remove a service from the configuration
     *
     * @param service - Service identifier
     */
    removeService(service: Service): void;
    /**
     * Get all added services
     *
     * @returns Array of service identifiers
     */
    getServices(): Service[];
    /**
     * Get configuration for a specific service
     *
     * @param service - Service identifier
     * @returns Service configuration or undefined
     */
    getServiceConfig(service: Service): ServiceConfig | undefined;
    /**
     * Clear all services and start fresh
     */
    clear(): void;
}
/**
 * Convenience function to create a new generator instance
 *
 * @returns DockerComposeGenerator instance
 */
declare function createDockerComposeGenerator(): DockerComposeGenerator;

declare const SetupProfileKindSchema: z.ZodEnum<["inference_only", "data_pod", "full"]>;
type SetupProfileKind = z.infer<typeof SetupProfileKindSchema>;
declare const SetupProfileSchema: z.ZodObject<{
    version: z.ZodLiteral<"1">;
    profile: z.ZodEnum<["inference_only", "data_pod", "full"]>;
    updatedAt: z.ZodString;
    domainHint: z.ZodOptional<z.ZodString>;
    hearthName: z.ZodOptional<z.ZodString>;
    source: z.ZodOptional<z.ZodEnum<["wizard", "usb_manifest", "cli"]>>;
    /** If set, `eve setup` runs `eve legs setup` with this tunnel after Data Pod / full stack steps. */
    tunnelProvider: z.ZodOptional<z.ZodEnum<["pangolin", "cloudflare"]>>;
    tunnelDomain: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    version: "1";
    updatedAt: string;
    profile: "inference_only" | "data_pod" | "full";
    domainHint?: string | undefined;
    hearthName?: string | undefined;
    source?: "wizard" | "usb_manifest" | "cli" | undefined;
    tunnelProvider?: "pangolin" | "cloudflare" | undefined;
    tunnelDomain?: string | undefined;
}, {
    version: "1";
    updatedAt: string;
    profile: "inference_only" | "data_pod" | "full";
    domainHint?: string | undefined;
    hearthName?: string | undefined;
    source?: "wizard" | "usb_manifest" | "cli" | undefined;
    tunnelProvider?: "pangolin" | "cloudflare" | undefined;
    tunnelDomain?: string | undefined;
}>;
type SetupProfile = z.infer<typeof SetupProfileSchema>;
declare function getSetupProfilePath(cwd?: string): string;
declare function readSetupProfile(cwd?: string): Promise<SetupProfile | null>;
/** Boot / USB handoff manifest (subset of setup profile). */
declare const UsbSetupManifestSchema: z.ZodObject<{
    version: z.ZodLiteral<"1">;
    target_profile: z.ZodEnum<["inference_only", "data_pod", "full"]>;
    hearth_name: z.ZodOptional<z.ZodString>;
    domain_hint: z.ZodOptional<z.ZodString>;
    tunnel_provider: z.ZodOptional<z.ZodEnum<["pangolin", "cloudflare"]>>;
    tunnel_domain: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    version: "1";
    target_profile: "inference_only" | "data_pod" | "full";
    hearth_name?: string | undefined;
    domain_hint?: string | undefined;
    tunnel_provider?: "pangolin" | "cloudflare" | undefined;
    tunnel_domain?: string | undefined;
}, {
    version: "1";
    target_profile: "inference_only" | "data_pod" | "full";
    hearth_name?: string | undefined;
    domain_hint?: string | undefined;
    tunnel_provider?: "pangolin" | "cloudflare" | undefined;
    tunnel_domain?: string | undefined;
}>;
type UsbSetupManifest = z.infer<typeof UsbSetupManifestSchema>;
declare function readUsbSetupManifest(): Promise<UsbSetupManifest | null>;
declare function writeSetupProfile(profile: Omit<SetupProfile, 'version' | 'updatedAt'> & {
    version?: '1';
    updatedAt?: string;
}, cwd?: string): Promise<void>;
declare function writeUsbSetupManifest(manifest: UsbSetupManifest, outputPath: string): Promise<void>;

interface HardwareFacts {
    hostname: string;
    platform: string;
    arch: string;
    cpuCores: number;
    cpuModel: string;
    totalMemoryBytes: number;
    totalMemoryGb: string;
    nvidiaSmi?: string;
}
declare function probeHardware(runNvidiaSmi: boolean): Promise<HardwareFacts>;
declare function formatHardwareReport(f: HardwareFacts): string;

declare const SecretsSchema: z.ZodObject<{
    version: z.ZodLiteral<"1">;
    updatedAt: z.ZodString;
    synap: z.ZodOptional<z.ZodObject<{
        apiUrl: z.ZodOptional<z.ZodString>;
        apiKey: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        apiUrl?: string | undefined;
        apiKey?: string | undefined;
    }, {
        apiUrl?: string | undefined;
        apiKey?: string | undefined;
    }>>;
    inference: z.ZodOptional<z.ZodObject<{
        ollamaUrl: z.ZodOptional<z.ZodString>;
        gatewayUrl: z.ZodOptional<z.ZodString>;
        gatewayUser: z.ZodOptional<z.ZodString>;
        gatewayPass: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        ollamaUrl?: string | undefined;
        gatewayUrl?: string | undefined;
        gatewayUser?: string | undefined;
        gatewayPass?: string | undefined;
    }, {
        ollamaUrl?: string | undefined;
        gatewayUrl?: string | undefined;
        gatewayUser?: string | undefined;
        gatewayPass?: string | undefined;
    }>>;
    builder: z.ZodOptional<z.ZodObject<{
        openclaudeUrl: z.ZodOptional<z.ZodString>;
        dokployApiUrl: z.ZodOptional<z.ZodString>;
        dokployApiKey: z.ZodOptional<z.ZodString>;
        workspaceDir: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        openclaudeUrl?: string | undefined;
        dokployApiUrl?: string | undefined;
        dokployApiKey?: string | undefined;
        workspaceDir?: string | undefined;
    }, {
        openclaudeUrl?: string | undefined;
        dokployApiUrl?: string | undefined;
        dokployApiKey?: string | undefined;
        workspaceDir?: string | undefined;
    }>>;
    arms: z.ZodOptional<z.ZodObject<{
        openclawSynapApiKey: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        openclawSynapApiKey?: string | undefined;
    }, {
        openclawSynapApiKey?: string | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    version: "1";
    updatedAt: string;
    arms?: {
        openclawSynapApiKey?: string | undefined;
    } | undefined;
    builder?: {
        openclaudeUrl?: string | undefined;
        dokployApiUrl?: string | undefined;
        dokployApiKey?: string | undefined;
        workspaceDir?: string | undefined;
    } | undefined;
    synap?: {
        apiUrl?: string | undefined;
        apiKey?: string | undefined;
    } | undefined;
    inference?: {
        ollamaUrl?: string | undefined;
        gatewayUrl?: string | undefined;
        gatewayUser?: string | undefined;
        gatewayPass?: string | undefined;
    } | undefined;
}, {
    version: "1";
    updatedAt: string;
    arms?: {
        openclawSynapApiKey?: string | undefined;
    } | undefined;
    builder?: {
        openclaudeUrl?: string | undefined;
        dokployApiUrl?: string | undefined;
        dokployApiKey?: string | undefined;
        workspaceDir?: string | undefined;
    } | undefined;
    synap?: {
        apiUrl?: string | undefined;
        apiKey?: string | undefined;
    } | undefined;
    inference?: {
        ollamaUrl?: string | undefined;
        gatewayUrl?: string | undefined;
        gatewayUser?: string | undefined;
        gatewayPass?: string | undefined;
    } | undefined;
}>;
type EveSecrets = z.infer<typeof SecretsSchema>;
declare function secretsPath(cwd?: string): string;
declare function readEveSecrets(cwd?: string): Promise<EveSecrets | null>;
declare function writeEveSecrets(partial: Omit<EveSecrets, 'version' | 'updatedAt'>, cwd?: string): Promise<EveSecrets>;
declare function ensureSecretValue(existing?: string): string;

/**
 * DNA Package - @eve/dna
 *
 * Core infrastructure for Hestia CLI:
 * - Configuration management (EveConfig)
 * - Credentials storage
 * - Entity state tracking
 * - Organ health monitoring
 * - Docker Compose generation
 *
 * @example
 * ```typescript
 * import { configManager, credentialsManager, entityStateManager } from '@eve/dna';
 *
 * // Load configuration
 * const config = await configManager.loadConfig();
 *
 * // Manage credentials
 * await credentialsManager.setCredential('api-key', 'secret123');
 *
 * // Track entity state
 * await entityStateManager.updateOrgan('brain', 'ready');
 * const completeness = await entityStateManager.getCompleteness();
 *
 * // Generate docker-compose.yml
 * import { DockerComposeGenerator } from '@eve/dna';
 * const generator = new DockerComposeGenerator();
 * generator.addBrainServices();
 * await generator.toFile('./docker-compose.yml');
 * ```
 */

declare const VERSION = "0.1.0";

export { type AIModel, ConfigManager, type Credentials, CredentialsManager, type DNAError, type DockerCompose, DockerComposeGenerator, type DockerComposeService, type EntityState, EntityStateManager, type EveConfig, type EveSecrets, type HardwareFacts, type Organ, type OrganState, type OrganStatus, type Service, type ServiceConfig, type SetupProfile, type SetupProfileKind, SetupProfileKindSchema, SetupProfileSchema, type UsbSetupManifest, UsbSetupManifestSchema, VERSION, configManager, createDockerComposeGenerator, credentialsManager, ensureSecretValue, entityStateManager, formatHardwareReport, getSetupProfilePath, probeHardware, readEveSecrets, readSetupProfile, readUsbSetupManifest, secretsPath, writeEveSecrets, writeSetupProfile, writeUsbSetupManifest };
