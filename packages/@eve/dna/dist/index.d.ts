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
type BuilderService = 'opencode' | 'openclaude' | 'claudecode' | 'dokploy';
type EyesService = 'rsshub';
type LegsService = 'traefik' | 'cloudflared' | 'pangolin' | 'newt';
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
declare const BuilderEngineSchema: z.ZodEnum<["opencode", "openclaude", "claudecode"]>;
declare const AiModeSchema: z.ZodEnum<["local", "provider", "hybrid"]>;
declare const AiProviderSchema: z.ZodEnum<["ollama", "openrouter", "anthropic", "openai"]>;
type BuilderEngine = z.infer<typeof BuilderEngineSchema>;
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
    /** Default builder codegen surface for `eve builder init` */
    builderEngine: z.ZodOptional<z.ZodEnum<["opencode", "openclaude", "claudecode"]>>;
    /** AI foundation mode selected during setup */
    aiMode: z.ZodOptional<z.ZodEnum<["local", "provider", "hybrid"]>>;
    aiDefaultProvider: z.ZodOptional<z.ZodEnum<["ollama", "openrouter", "anthropic", "openai"]>>;
    aiFallbackProvider: z.ZodOptional<z.ZodEnum<["ollama", "openrouter", "anthropic", "openai"]>>;
    /** Canonical network intent selected during setup. */
    network: z.ZodOptional<z.ZodObject<{
        exposureMode: z.ZodEnum<["local", "public"]>;
        synapHost: z.ZodString;
        legs: z.ZodOptional<z.ZodObject<{
            tunnelProvider: z.ZodOptional<z.ZodEnum<["pangolin", "cloudflare"]>>;
            hostStrategy: z.ZodOptional<z.ZodEnum<["same_as_synap", "custom"]>>;
            host: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            tunnelProvider?: "pangolin" | "cloudflare" | undefined;
            hostStrategy?: "custom" | "same_as_synap" | undefined;
            host?: string | undefined;
        }, {
            tunnelProvider?: "pangolin" | "cloudflare" | undefined;
            hostStrategy?: "custom" | "same_as_synap" | undefined;
            host?: string | undefined;
        }>>;
    }, "strip", z.ZodTypeAny, {
        exposureMode: "local" | "public";
        synapHost: string;
        legs?: {
            tunnelProvider?: "pangolin" | "cloudflare" | undefined;
            hostStrategy?: "custom" | "same_as_synap" | undefined;
            host?: string | undefined;
        } | undefined;
    }, {
        exposureMode: "local" | "public";
        synapHost: string;
        legs?: {
            tunnelProvider?: "pangolin" | "cloudflare" | undefined;
            hostStrategy?: "custom" | "same_as_synap" | undefined;
            host?: string | undefined;
        } | undefined;
    }>>;
    /** Non-secret Synap install preferences used to resume setup after interruption. */
    synapInstall: z.ZodOptional<z.ZodObject<{
        mode: z.ZodOptional<z.ZodEnum<["auto", "from_image", "from_source"]>>;
        tlsEmail: z.ZodOptional<z.ZodString>;
        withOpenclaw: z.ZodOptional<z.ZodBoolean>;
        withRsshub: z.ZodOptional<z.ZodBoolean>;
        adminBootstrapMode: z.ZodOptional<z.ZodEnum<["token", "preseed"]>>;
        adminEmail: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        mode?: "auto" | "from_image" | "from_source" | undefined;
        tlsEmail?: string | undefined;
        withOpenclaw?: boolean | undefined;
        withRsshub?: boolean | undefined;
        adminBootstrapMode?: "token" | "preseed" | undefined;
        adminEmail?: string | undefined;
    }, {
        mode?: "auto" | "from_image" | "from_source" | undefined;
        tlsEmail?: string | undefined;
        withOpenclaw?: boolean | undefined;
        withRsshub?: boolean | undefined;
        adminBootstrapMode?: "token" | "preseed" | undefined;
        adminEmail?: string | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    version: "1";
    updatedAt: string;
    profile: "inference_only" | "data_pod" | "full";
    network?: {
        exposureMode: "local" | "public";
        synapHost: string;
        legs?: {
            tunnelProvider?: "pangolin" | "cloudflare" | undefined;
            hostStrategy?: "custom" | "same_as_synap" | undefined;
            host?: string | undefined;
        } | undefined;
    } | undefined;
    domainHint?: string | undefined;
    hearthName?: string | undefined;
    source?: "wizard" | "usb_manifest" | "cli" | undefined;
    tunnelProvider?: "pangolin" | "cloudflare" | undefined;
    tunnelDomain?: string | undefined;
    builderEngine?: "opencode" | "openclaude" | "claudecode" | undefined;
    aiMode?: "local" | "provider" | "hybrid" | undefined;
    aiDefaultProvider?: "ollama" | "openai" | "anthropic" | "openrouter" | undefined;
    aiFallbackProvider?: "ollama" | "openai" | "anthropic" | "openrouter" | undefined;
    synapInstall?: {
        mode?: "auto" | "from_image" | "from_source" | undefined;
        tlsEmail?: string | undefined;
        withOpenclaw?: boolean | undefined;
        withRsshub?: boolean | undefined;
        adminBootstrapMode?: "token" | "preseed" | undefined;
        adminEmail?: string | undefined;
    } | undefined;
}, {
    version: "1";
    updatedAt: string;
    profile: "inference_only" | "data_pod" | "full";
    network?: {
        exposureMode: "local" | "public";
        synapHost: string;
        legs?: {
            tunnelProvider?: "pangolin" | "cloudflare" | undefined;
            hostStrategy?: "custom" | "same_as_synap" | undefined;
            host?: string | undefined;
        } | undefined;
    } | undefined;
    domainHint?: string | undefined;
    hearthName?: string | undefined;
    source?: "wizard" | "usb_manifest" | "cli" | undefined;
    tunnelProvider?: "pangolin" | "cloudflare" | undefined;
    tunnelDomain?: string | undefined;
    builderEngine?: "opencode" | "openclaude" | "claudecode" | undefined;
    aiMode?: "local" | "provider" | "hybrid" | undefined;
    aiDefaultProvider?: "ollama" | "openai" | "anthropic" | "openrouter" | undefined;
    aiFallbackProvider?: "ollama" | "openai" | "anthropic" | "openrouter" | undefined;
    synapInstall?: {
        mode?: "auto" | "from_image" | "from_source" | undefined;
        tlsEmail?: string | undefined;
        withOpenclaw?: boolean | undefined;
        withRsshub?: boolean | undefined;
        adminBootstrapMode?: "token" | "preseed" | undefined;
        adminEmail?: string | undefined;
    } | undefined;
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
    ai: z.ZodOptional<z.ZodObject<{
        mode: z.ZodOptional<z.ZodEnum<["local", "provider", "hybrid"]>>;
        defaultProvider: z.ZodOptional<z.ZodEnum<["ollama", "openrouter", "anthropic", "openai"]>>;
        fallbackProvider: z.ZodOptional<z.ZodEnum<["ollama", "openrouter", "anthropic", "openai"]>>;
        providers: z.ZodOptional<z.ZodArray<z.ZodObject<{
            id: z.ZodEnum<["ollama", "openrouter", "anthropic", "openai"]>;
            enabled: z.ZodOptional<z.ZodBoolean>;
            apiKey: z.ZodOptional<z.ZodString>;
            baseUrl: z.ZodOptional<z.ZodString>;
            defaultModel: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            id: "ollama" | "openai" | "anthropic" | "openrouter";
            enabled?: boolean | undefined;
            apiKey?: string | undefined;
            baseUrl?: string | undefined;
            defaultModel?: string | undefined;
        }, {
            id: "ollama" | "openai" | "anthropic" | "openrouter";
            enabled?: boolean | undefined;
            apiKey?: string | undefined;
            baseUrl?: string | undefined;
            defaultModel?: string | undefined;
        }>, "many">>;
        /** Sync intent flag used by explicit `eve ai sync --workspace <id>` command. */
        syncToSynap: z.ZodOptional<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        mode?: "local" | "provider" | "hybrid" | undefined;
        defaultProvider?: "ollama" | "openai" | "anthropic" | "openrouter" | undefined;
        fallbackProvider?: "ollama" | "openai" | "anthropic" | "openrouter" | undefined;
        providers?: {
            id: "ollama" | "openai" | "anthropic" | "openrouter";
            enabled?: boolean | undefined;
            apiKey?: string | undefined;
            baseUrl?: string | undefined;
            defaultModel?: string | undefined;
        }[] | undefined;
        syncToSynap?: boolean | undefined;
    }, {
        mode?: "local" | "provider" | "hybrid" | undefined;
        defaultProvider?: "ollama" | "openai" | "anthropic" | "openrouter" | undefined;
        fallbackProvider?: "ollama" | "openai" | "anthropic" | "openrouter" | undefined;
        providers?: {
            id: "ollama" | "openai" | "anthropic" | "openrouter";
            enabled?: boolean | undefined;
            apiKey?: string | undefined;
            baseUrl?: string | undefined;
            defaultModel?: string | undefined;
        }[] | undefined;
        syncToSynap?: boolean | undefined;
    }>>;
    synap: z.ZodOptional<z.ZodObject<{
        apiUrl: z.ZodOptional<z.ZodString>;
        apiKey: z.ZodOptional<z.ZodString>;
        /** Full Hub base URL; if unset, Eve derives `${apiUrl}/api/hub` */
        hubBaseUrl: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        apiKey?: string | undefined;
        apiUrl?: string | undefined;
        hubBaseUrl?: string | undefined;
    }, {
        apiKey?: string | undefined;
        apiUrl?: string | undefined;
        hubBaseUrl?: string | undefined;
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
        codeEngine: z.ZodOptional<z.ZodEnum<["opencode", "openclaude", "claudecode"]>>;
        openclaudeUrl: z.ZodOptional<z.ZodString>;
        dokployApiUrl: z.ZodOptional<z.ZodString>;
        dokployApiKey: z.ZodOptional<z.ZodString>;
        dokployWebhookUrl: z.ZodOptional<z.ZodString>;
        workspaceDir: z.ZodOptional<z.ZodString>;
        skillsDir: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        codeEngine?: "opencode" | "openclaude" | "claudecode" | undefined;
        openclaudeUrl?: string | undefined;
        dokployApiUrl?: string | undefined;
        dokployApiKey?: string | undefined;
        dokployWebhookUrl?: string | undefined;
        workspaceDir?: string | undefined;
        skillsDir?: string | undefined;
    }, {
        codeEngine?: "opencode" | "openclaude" | "claudecode" | undefined;
        openclaudeUrl?: string | undefined;
        dokployApiUrl?: string | undefined;
        dokployApiKey?: string | undefined;
        dokployWebhookUrl?: string | undefined;
        workspaceDir?: string | undefined;
        skillsDir?: string | undefined;
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
        codeEngine?: "opencode" | "openclaude" | "claudecode" | undefined;
        openclaudeUrl?: string | undefined;
        dokployApiUrl?: string | undefined;
        dokployApiKey?: string | undefined;
        dokployWebhookUrl?: string | undefined;
        workspaceDir?: string | undefined;
        skillsDir?: string | undefined;
    } | undefined;
    synap?: {
        apiKey?: string | undefined;
        apiUrl?: string | undefined;
        hubBaseUrl?: string | undefined;
    } | undefined;
    ai?: {
        mode?: "local" | "provider" | "hybrid" | undefined;
        defaultProvider?: "ollama" | "openai" | "anthropic" | "openrouter" | undefined;
        fallbackProvider?: "ollama" | "openai" | "anthropic" | "openrouter" | undefined;
        providers?: {
            id: "ollama" | "openai" | "anthropic" | "openrouter";
            enabled?: boolean | undefined;
            apiKey?: string | undefined;
            baseUrl?: string | undefined;
            defaultModel?: string | undefined;
        }[] | undefined;
        syncToSynap?: boolean | undefined;
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
        codeEngine?: "opencode" | "openclaude" | "claudecode" | undefined;
        openclaudeUrl?: string | undefined;
        dokployApiUrl?: string | undefined;
        dokployApiKey?: string | undefined;
        dokployWebhookUrl?: string | undefined;
        workspaceDir?: string | undefined;
        skillsDir?: string | undefined;
    } | undefined;
    synap?: {
        apiKey?: string | undefined;
        apiUrl?: string | undefined;
        hubBaseUrl?: string | undefined;
    } | undefined;
    ai?: {
        mode?: "local" | "provider" | "hybrid" | undefined;
        defaultProvider?: "ollama" | "openai" | "anthropic" | "openrouter" | undefined;
        fallbackProvider?: "ollama" | "openai" | "anthropic" | "openrouter" | undefined;
        providers?: {
            id: "ollama" | "openai" | "anthropic" | "openrouter";
            enabled?: boolean | undefined;
            apiKey?: string | undefined;
            baseUrl?: string | undefined;
            defaultModel?: string | undefined;
        }[] | undefined;
        syncToSynap?: boolean | undefined;
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

/** Default Hub Protocol path on the Synap API host (Better Auth / Hub REST). */
declare const DEFAULT_HUB_PATH = "/api/hub";
declare function resolveHubBaseUrl(secrets: EveSecrets | null): string | undefined;
declare function defaultSkillsDir(): string;
/**
 * Ensures ~/.eve/skills/synap/SKILL.md exists (OpenClaw-style layout; Claude Code can symlink into .claude/skills).
 */
declare function ensureEveSkillsLayout(skillsDir?: string): void;
/**
 * Dotenv for OpenCode / sandbox / any tool that reads `.env` in the project root.
 */
declare function writeBuilderProjectEnv(projectDir: string, cwd?: string): Promise<void>;
/** Writes `.eve/sandbox.env` for docker compose --env-file */
declare function writeSandboxEnvFile(cwd?: string): Promise<string>;
/**
 * Claude Code loads skills from `<project>/.claude/skills/<name>/SKILL.md` (see code.claude.com docs).
 * Copies the Eve synap stub into the project (portable; no symlink privileges).
 */
declare function copySynapSkillIntoClaudeProject(projectDir: string, skillsDir?: string): void;
/**
 * Claude Code `settings.json` env block (see https://code.claude.com/docs/en/settings ).
 */
declare function writeClaudeCodeSettings(projectDir: string, cwd?: string): Promise<void>;

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

export { type AIModel, AiModeSchema, AiProviderSchema, type BuilderEngine, BuilderEngineSchema, ConfigManager, type Credentials, CredentialsManager, DEFAULT_HUB_PATH, type DNAError, type DockerCompose, DockerComposeGenerator, type DockerComposeService, type EntityState, EntityStateManager, type EveConfig, type EveSecrets, type HardwareFacts, type Organ, type OrganState, type OrganStatus, type Service, type ServiceConfig, type SetupProfile, type SetupProfileKind, SetupProfileKindSchema, SetupProfileSchema, type UsbSetupManifest, UsbSetupManifestSchema, VERSION, configManager, copySynapSkillIntoClaudeProject, createDockerComposeGenerator, credentialsManager, defaultSkillsDir, ensureEveSkillsLayout, ensureSecretValue, entityStateManager, formatHardwareReport, getSetupProfilePath, probeHardware, readEveSecrets, readSetupProfile, readUsbSetupManifest, resolveHubBaseUrl, secretsPath, writeBuilderProjectEnv, writeClaudeCodeSettings, writeEveSecrets, writeSandboxEnvFile, writeSetupProfile, writeUsbSetupManifest };
