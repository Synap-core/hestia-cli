/**
 * Hestia CLI - Centralized Type System
 *
 * All types in one place for build-time, lint-time, and dev-time verification.
 * Uses proper enums and strict type safety.
 */
export declare enum PackageType {
    CORE = "core",
    GATEWAY = "gateway",
    BUILDER = "builder",
    INTELLIGENCE = "intelligence",
    INFRASTRUCTURE = "infrastructure",
    CONNECTOR = "connector"
}
export declare enum PackageSourceType {
    DOCKER_COMPOSE = "docker_compose",
    BINARY = "binary",
    NPM = "npm",
    GIT = "git"
}
export declare enum PackageStatus {
    INSTALLED = "installed",
    RUNNING = "running",
    STOPPED = "stopped",
    ERROR = "error",
    UPDATING = "updating"
}
export declare enum HearthRole {
    PRIMARY = "primary",
    BACKUP = "backup",
    EDGE = "edge"
}
export declare enum InstallMode {
    USB = "usb",
    SCRIPT = "script"
}
export declare enum HealthStatus {
    HEALTHY = "healthy",
    DEGRADED = "degraded",
    OFFLINE = "offline"
}
export declare enum IntelligenceProvider {
    OLLAMA = "ollama",
    OPENROUTER = "openrouter",
    ANTHROPIC = "anthropic",
    OPENAI = "openai",
    CUSTOM = "custom"
}
export declare enum DeploymentStatus {
    PENDING = "pending",
    BUILDING = "building",
    DEPLOYED = "deployed",
    FAILED = "failed"
}
export declare enum ArtifactType {
    STATIC = "static",
    CONTAINERIZED = "containerized"
}
export declare enum SourceType {
    GIT = "git",
    WORKSPACE = "workspace",
    UPLOAD = "upload"
}
export declare enum AIChatProvider {
    LOBECHAT = "lobechat",
    OPENWEBUI = "openwebui",
    LIBRECHAT = "librechat"
}
export declare enum ProxyType {
    NGINX = "nginx",
    TRAEFIK = "traefik"
}
export declare enum TunnelProvider {
    PANGOLIN = "pangolin",
    CLOUDFLARE = "cloudflare",
    NONE = "none"
}
export declare enum DBViewerProvider {
    WHODB = "whodb",
    NONE = "none"
}
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
    lastHeartbeat?: string;
    intelligenceProviderId?: string;
    packages: string[];
    apiKeyId?: string;
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
    tools?: unknown[];
    stream?: boolean;
}
export interface ChatCompletionResponse {
    id: string;
    object: string;
    created: number;
    model: string;
    choices: {
        index: number;
        message: {
            role: string;
            content: string;
            tool_calls?: unknown[];
        };
        finish_reason: string;
    }[];
    usage: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
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
export * from "./config-types.js";
export * from "./ai-chat.js";
//# sourceMappingURL=index.d.ts.map