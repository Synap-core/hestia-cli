/**
 * Hestia CLI - Core Types
 *
 * Central type definitions for the Hestia package system.
 */
export interface Package {
    name: string;
    version: string;
    description?: string;
    author?: string;
    license?: string;
    type: "core" | "gateway" | "builder" | "intelligence" | "infrastructure" | "connector";
    source: {
        type: "docker_compose" | "binary" | "npm" | "git";
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
    status: "installed" | "running" | "stopped" | "error" | "updating";
    config: Record<string, unknown>;
    endpoints?: {
        http?: string;
        websocket?: string;
        grpc?: string;
    };
    health?: {
        status: "healthy" | "degraded" | "unhealthy";
        lastCheck: Date;
        message?: string;
    };
    installedAt: Date;
    lastUpdated: Date;
}
export interface HearthNode {
    id: string;
    hostname: string;
    ipAddress?: string;
    role: "primary" | "backup";
    installMode: "usb" | "script";
    healthStatus: "healthy" | "degraded" | "offline" | "unknown";
    lastHeartbeat?: Date;
    packages: PackageInstance[];
    intelligenceProviderId?: string;
    apiKeyId?: string;
    workspaceId?: string;
    entityId?: string;
    createdAt: Date;
    updatedAt: Date;
}
export type IntelligenceProviderType = "ollama" | "openrouter" | "anthropic" | "openai" | "custom";
export interface IntelligenceProvider {
    id: string;
    providerType: IntelligenceProviderType;
    endpointUrl?: string;
    apiKeyEnv?: string;
    model: string;
    status: "active" | "inactive" | "error";
    capabilities: string[];
    config?: Record<string, unknown>;
    entityId?: string;
}
export interface IntelligenceConfig {
    provider: IntelligenceProviderType;
    endpoint?: string;
    apiKey?: string;
    model: string;
    temperature?: number;
    maxTokens?: number;
}
export interface ChatMessage {
    role: "system" | "user" | "assistant";
    content: string;
    name?: string;
}
export interface ChatCompletionRequest {
    messages: ChatMessage[];
    model?: string;
    temperature?: number;
    maxTokens?: number;
    tools?: Tool[];
    stream?: boolean;
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
export interface Deployment {
    id: string;
    hearthNodeId: string;
    deployPath: string;
    artifactType: "static" | "containerized";
    sourceType: "git" | "workspace" | "upload";
    sourceUrl?: string;
    url?: string;
    status: "pending" | "approved" | "building" | "deployed" | "failed";
    buildLog?: string;
    commandsExecuted: string[];
    approvals?: Approval[];
    startedAt?: Date;
    completedAt?: Date;
    entityId?: string;
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
export interface TunnelConfig {
    enabled: boolean;
    provider: "pangolin" | "cloudflare" | "none";
    mode?: "server" | "client";
    serverUrl?: string;
    token?: string;
    publicUrl?: string;
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
export interface HestiaConfig {
    version: string;
    hearth: {
        id: string;
        name: string;
        role: "primary" | "backup";
        domain?: string;
        reverseProxy?: "nginx" | "traefik";
    };
    packages: Record<string, PackageConfig>;
    intelligence?: IntelligenceConfig;
    reverseProxy?: "nginx" | "traefik";
    connectors?: {
        controlPlane?: ControlPlaneConfig;
    };
    tunnel?: TunnelConfig;
    dbViewer?: DBViewerConfig;
    aiChat?: AIChatConfig;
    optionalServices?: Record<string, OptionalServiceConfig>;
}
export interface AIChatConfig {
    providers: AIChatProviderConfig[];
    defaultProvider?: AIChatProvider;
}
export type AIChatProvider = "lobechat" | "openwebui" | "librechat";
export interface AIChatProviderConfig {
    name: AIChatProvider;
    enabled: boolean;
    port: number;
    url?: string;
    config?: Record<string, unknown>;
}
export interface AIChatProviderStatus {
    provider: AIChatProvider;
    name: string;
    installed: boolean;
    running: boolean;
    accessible: boolean;
    port: number;
    url: string;
    health: "healthy" | "degraded" | "unhealthy";
    error?: string;
}
export interface DBViewerConfig {
    enabled: boolean;
    provider: "whodb" | "none";
    port: number;
    aiEnabled: boolean;
    databases: string[];
}
export interface PackageConfig {
    enabled: boolean;
    version?: string;
    config?: Record<string, unknown>;
}
export interface ControlPlaneConfig {
    enabled: boolean;
    url: string;
    token?: string;
    role?: "primary" | "backup" | "fleet-member";
    backupHearths?: string[];
    fleetId?: string;
}
export interface CLIOptions {
    verbose: boolean;
    dryRun: boolean;
    configPath: string;
    workspaceId?: string;
    podUrl?: string;
    apiKey?: string;
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
export interface EntityService {
    create(entity: Partial<Entity>): Promise<Entity>;
    get(id: string): Promise<Entity | null>;
    update(id: string, data: Partial<Entity>): Promise<Entity>;
    delete(id: string): Promise<void>;
    list(params: ListParams): Promise<Entity[]>;
    findOne(filter: Record<string, unknown>): Promise<Entity | null>;
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
export interface RegisterHearthConfig {
    hostname: string;
    role: "primary" | "backup";
    installMode: "usb" | "script";
    intelligenceProvider: IntelligenceProvider;
}
export interface HeartbeatData {
    packages: PackageInstance[];
    intelligence?: {
        providerType: IntelligenceProviderType;
        status: "healthy" | "degraded" | "offline";
        model?: string;
    };
    healthStatus: "healthy" | "degraded" | "offline";
    resourceUsage?: {
        cpu: number;
        memory: number;
        disk: number;
    };
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
//# sourceMappingURL=types.d.ts.map