/**
 * Hestia CLI - Centralized Type System
 *
 * All types in one place for build-time, lint-time, and dev-time verification.
 * Uses proper enums and strict type safety.
 */
export type PackageType = "core" | "gateway" | "builder" | "intelligence" | "infrastructure" | "connector";
export type PackageSourceType = "docker_compose" | "binary" | "npm" | "git";
export type PackageStatus = "installed" | "running" | "stopped" | "error" | "updating";
export type HearthRole = "primary" | "backup" | "edge";
export type InstallMode = "usb" | "script";
export type HealthStatus = "healthy" | "degraded" | "offline" | "unhealthy";
export type IntelligenceProvider = "ollama" | "openrouter" | "anthropic" | "openai" | "custom";
export type DeploymentStatus = "pending" | "building" | "deployed" | "failed";
export type ArtifactType = "static" | "containerized";
export type SourceType = "git" | "workspace" | "upload";
export type ProxyType = "nginx" | "traefik";
export type TunnelProvider = "pangolin" | "cloudflare" | "none";
export type DBViewerProvider = "whodb" | "none";
export type AIChatProvider = "lobechat" | "openwebui" | "librechat";
export interface Package {
    name: string;
    version: string;
    description?: string;
    author?: string;
    license?: string;
    type: PackageType;
    source: {
        type: PackageSourceType;
        url: string;
        composeFile?: string;
        binaryPath?: string;
    };
    config?: {
        schema: Record<string, unknown>;
        defaults: Record<string, unknown>;
    };
    requires?: PackageDependency[];
    provides: string[];
    connectsTo?: string[];
}
export interface PackageDependency {
    name: string;
    versionRange: string;
    optional?: boolean;
}
export interface PackageInstance {
    id: string;
    packageName: string;
    version: string;
    status: PackageStatus;
    config: Record<string, unknown>;
    endpoints?: {
        http?: string;
        websocket?: string;
        grpc?: string;
    };
    health?: {
        status: HealthStatus;
        lastCheck: Date;
        message?: string;
    };
    installedAt: Date;
    lastUpdated: Date;
}
export interface PackageConfig {
    enabled: boolean;
    version?: string;
    config?: Record<string, unknown>;
}
export interface HearthNode {
    id: string;
    hostname: string;
    role: HearthRole;
    ipAddress?: string;
    installMode: InstallMode;
    healthStatus: HealthStatus;
    lastHeartbeat?: Date;
    intelligenceProviderId?: string;
    packages: string[];
    apiKeyId?: string;
    workspaceId?: string;
    entityId?: string;
    createdAt: Date;
    updatedAt: Date;
}
export interface RegisterHearthConfig {
    hostname: string;
    role: HearthRole;
    installMode: InstallMode;
    ipAddress?: string;
    intelligenceProvider: IntelligenceProviderConfig;
}
export interface IntelligenceProviderConfig {
    provider: IntelligenceProvider;
    endpointUrl?: string;
    apiKeyEnv?: string;
    model: string;
    config?: Record<string, unknown>;
}
export interface IntelligenceConfig {
    provider: IntelligenceProvider;
    endpoint?: string;
    apiKey?: string;
    model: string;
    temperature?: number;
    maxTokens?: number;
}
export interface HeartbeatData {
    packages: PackageInstance[];
    intelligence?: {
        provider: IntelligenceProvider;
        status: HealthStatus;
        model?: string;
    };
    healthStatus: HealthStatus;
    resourceUsage?: {
        cpu: number;
        memory: number;
        disk: number;
    };
}
export interface Deployment {
    id: string;
    hearthNodeId: string;
    sourceType: SourceType;
    sourceUrl?: string;
    artifactType: ArtifactType;
    status: DeploymentStatus;
    deployUrl?: string;
    createdAt: string;
}
export interface CreateDeploymentConfig {
    hearthNodeId: string;
    sourceType: SourceType;
    sourceUrl?: string;
    artifactType: ArtifactType;
    status?: DeploymentStatus;
}
export interface AIChatProviderConfig {
    name: AIChatProvider;
    enabled: boolean;
    port: number;
    url?: string;
    config?: Record<string, unknown>;
}
export interface AIChatConfig {
    providers: AIChatProviderConfig[];
    defaultProvider?: AIChatProvider;
}
export interface DBViewerConfig {
    enabled: boolean;
    provider: DBViewerProvider;
    port: number;
    aiEnabled: boolean;
    databases: string[];
}
export interface TunnelConfig {
    enabled: boolean;
    provider: TunnelProvider;
    mode?: "server" | "client";
    serverUrl?: string;
    token?: string;
    publicUrl?: string;
}
export interface ControlPlaneConfig {
    enabled: boolean;
    url: string;
    token?: string;
    role?: "primary" | "backup" | "fleet-member";
    backupHearths?: string[];
    fleetId?: string;
}
export interface ConnectorsConfig {
    controlPlane?: ControlPlaneConfig;
}
export interface HestiaConfig {
    version: string;
    hearth: {
        id?: string;
        name: string;
        role: HearthRole;
        domain?: string;
        reverseProxy: ProxyType;
    };
    packages: Record<string, PackageConfig>;
    intelligence?: IntelligenceConfig;
    reverseProxy?: ProxyType;
    dbViewer?: DBViewerConfig;
    connectors?: ConnectorsConfig;
    tunnel?: TunnelConfig;
    aiChat?: AIChatConfig;
    optionalServices?: Record<string, OptionalServiceConfig>;
    pod?: HestiaPodConfig;
    aiPlatform?: "opencode" | "openclaude" | "later";
    logLevel?: "debug" | "info" | "warn" | "error" | "silent";
    packagesDirectory?: string;
    registryUrl?: string;
    synapBackendUrl?: string;
    apiKey?: string;
}
export interface OptionalServiceConfig {
    enabled: boolean;
    installed: boolean;
    autoStart: boolean;
    ports?: Record<string, number>;
    environment?: Record<string, string>;
    volumeMounts?: Record<string, string>;
    customConfig?: Record<string, unknown>;
}
export interface ChatMessage {
    role: "system" | "user" | "assistant";
    content: string;
}
export interface ChatCompletionRequest {
    messages: ChatMessage[];
    model?: string;
    temperature?: number;
    maxTokens?: number;
    tools?: Tool[];
    stream?: boolean;
}
export interface ChatMessage {
    role: "system" | "user" | "assistant";
    content: string;
    name?: string;
}
export interface Tool {
    type: "function";
    function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
    };
}
export interface ChatCompletionResponse {
    id: string;
    object: "chat.completion";
    created: number;
    model: string;
    choices: {
        index: number;
        message: ChatMessage;
        finishReason: string;
    }[];
    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
}
export interface APIResponse<T> {
    success: boolean;
    data?: T;
    error?: string;
}
export interface APIClientConfig {
    baseUrl: string;
    apiKey: string;
    workspaceId: string;
    timeout?: number;
}
export type ConfigPath = string;
export type ConfigPaths = {
    configDir: string;
    systemConfigDir: string;
    userConfig: string;
    systemConfig: string;
    credentials: string;
    packagesDir: string;
    registryCache: string;
};
export interface HestiaPodConfig {
    url: string;
    apiKey: string;
    workspaceId?: string;
}
export interface IntelligenceProviderFull {
    id: string;
    providerType: IntelligenceProvider;
    endpointUrl?: string;
    apiKeyEnv?: string;
    model: string;
    status: "active" | "inactive" | "error";
    capabilities: string[];
    config?: Record<string, unknown>;
    entityId?: string;
}
export interface IntelligenceConfigFull {
    provider: IntelligenceProvider;
    endpoint?: string;
    apiKey?: string;
    model: string;
    temperature?: number;
    maxTokens?: number;
}
export interface Approval {
    id: string;
    requester: string;
    approver?: string;
    status: "pending" | "approved" | "denied";
    requestedAt: Date;
    respondedAt?: Date;
    reason?: string;
}
export type AIPlatform = "opencode" | "openclaude" | "later";
export interface CLIOptions {
    verbose: boolean;
    dryRun: boolean;
    configPath: string;
    workspaceId?: string;
    podUrl?: string;
    apiKey?: string;
}
export interface Entity {
    id: string;
    workspaceId: string;
    profileSlug: string;
    title: string;
    properties: Record<string, unknown>;
    createdAt: Date;
    updatedAt: Date;
}
export interface ListParams {
    workspaceId?: string;
    profileSlug?: string;
    filter?: Record<string, unknown>;
    limit?: number;
    offset?: number;
}
export interface EntityService {
    create(entity: Partial<Entity>): Promise<Entity>;
    get(id: string): Promise<Entity | null>;
    update(id: string, data: Partial<Entity>): Promise<Entity>;
    delete(id: string): Promise<void>;
    list(params: ListParams): Promise<Entity[]>;
    findOne(filter: Record<string, unknown>): Promise<Entity | null>;
}
export interface PackageService {
    install(pkg: Package): Promise<PackageInstance>;
    uninstall(packageName: string): Promise<void>;
    update(packageName: string, version: string): Promise<PackageInstance>;
    start(packageName: string): Promise<void>;
    stop(packageName: string): Promise<void>;
    status(packageName: string): Promise<PackageInstance>;
    list(): Promise<PackageInstance[]>;
}
export interface HearthService {
    register(config: RegisterHearthConfig): Promise<HearthNode>;
    heartbeat(nodeId: string, data: HeartbeatData): Promise<void>;
    status(nodeId: string): Promise<HearthNode>;
    list(): Promise<HearthNode[]>;
}
export interface IntelligenceService {
    query(request: ChatCompletionRequest): Promise<ChatCompletionResponse>;
    listModels(providerId: string): Promise<{
        id: string;
        name: string;
    }[]>;
    healthCheck(providerId: string): Promise<{
        status: string;
        model?: string;
    }>;
}
export interface CommandContext {
    options: CLIOptions;
    config: HestiaConfig;
    services: {
        entityService: EntityService;
        packageService: PackageService;
        hearthService: HearthService;
        intelligenceService: IntelligenceService;
    };
}
export declare class HestiaError extends Error {
    code: string;
    exitCode: number;
    constructor(message: string, code: string, exitCode?: number);
}
export declare class PackageError extends HestiaError {
    packageName: string;
    constructor(message: string, packageName: string);
}
export declare class HearthError extends HestiaError {
    hearthId: string;
    constructor(message: string, hearthId: string);
}
export declare class IntelligenceError extends HestiaError {
    providerType: string;
    constructor(message: string, providerType: string);
}
export type DeepPartial<T> = {
    [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};
export type Nullable<T> = {
    [P in keyof T]: T[P] | null;
};
export type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;
export interface HestiaEvent {
    type: string;
    timestamp: Date;
    data: unknown;
}
export type EventHandler = (event: HestiaEvent) => void | Promise<void>;
export interface Logger {
    debug: (message: string, meta?: Record<string, unknown>) => void;
    info: (message: string, meta?: Record<string, unknown>) => void;
    success: (message: string, meta?: Record<string, unknown>) => void;
    warn: (message: string, meta?: Record<string, unknown>) => void;
    error: (message: string, meta?: Record<string, unknown>) => void;
}
export interface ProgressReporter {
    start(total: number, message?: string): void;
    update(current: number, message?: string): void;
    increment(message?: string): void;
    finish(message?: string): void;
    fail(message: string): void;
}
export * from "./extra-types.js";
//# sourceMappingURL=index.d.ts.map