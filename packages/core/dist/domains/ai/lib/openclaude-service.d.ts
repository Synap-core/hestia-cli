/**
 * Hestia CLI - OpenClaude Service
 *
 * Wraps @gitlawb/openclaude CLI and integrates it with Hestia infrastructure.
 * Provides process management, configuration translation, MCP server management,
 * and Synap Backend integration.
 */
import type { Logger } from '../../../lib/types/index.js';
export interface OpenClaudeServiceOptions {
    /** Custom configuration path */
    configPath?: string;
    /** Custom logger instance */
    logger?: Logger;
    /** Auto-restart on crash */
    autoRestart?: boolean;
    /** Maximum restart attempts */
    maxRestarts?: number;
    /** Working directory for OpenClaude */
    workingDir?: string;
}
export interface OpenClaudeStatus {
    isRunning: boolean;
    pid?: number;
    uptime?: number;
    lastStartTime?: Date;
    restartCount: number;
    profileLoaded?: string;
    currentProvider?: string;
    errors: string[];
}
export interface MCPInstallConfig {
    /** MCP server name */
    name: string;
    /** Server command (e.g., "npx", "node", "python") */
    command: string;
    /** Arguments for the command */
    args?: string[];
    /** Environment variables */
    env?: Record<string, string>;
    /** Server URL if using SSE transport */
    url?: string;
}
export interface MCPInstalledServer {
    name: string;
    enabled: boolean;
    command: string;
    args: string[];
    transport: "stdio" | "sse";
}
export interface OpenClaudeProfile {
    version: string;
    name: string;
    provider: string;
    model: string;
    apiKey?: string;
    endpoint?: string;
    temperature?: number;
    maxTokens?: number;
    mcpServers?: Record<string, MCPInstalledServer>;
    hestiaIntegration?: {
        enabled: boolean;
        backendUrl?: string;
        apiKey?: string;
        workspaceId?: string;
    };
}
export interface ProviderConfig {
    provider: "ollama" | "openrouter" | "anthropic" | "openai" | "custom";
    model: string;
    endpoint?: string;
    apiKey?: string;
    temperature?: number;
    maxTokens?: number;
}
export interface ExecuteResult {
    success: boolean;
    output?: string;
    error?: string;
    exitCode?: number;
}
export declare class OpenClaudeService {
    private process;
    private status;
    private options;
    private logger;
    private restartAttempts;
    private startTime?;
    private profilePath;
    private hestiaConfig?;
    constructor(options?: OpenClaudeServiceOptions);
    /**
     * Start OpenClaude with Hestia configuration
     */
    start(startOptions?: {
        profile?: string;
        command?: string;
    }): Promise<void>;
    /**
     * Stop OpenClaude process gracefully
     */
    stop(timeout?: number): Promise<void>;
    /**
     * Check if OpenClaude is currently running
     */
    isRunning(): boolean;
    /**
     * Get current OpenClaude status
     */
    getStatus(): OpenClaudeStatus;
    /**
     * Configure AI provider (Ollama, OpenRouter, etc.)
     */
    configureProvider(config: ProviderConfig): Promise<void>;
    /**
     * Get current provider configuration
     */
    getProviderConfig(): Promise<ProviderConfig | null>;
    /**
     * Install an MCP server
     */
    installMCPServer(name: string, mcpConfig: MCPInstallConfig): Promise<void>;
    /**
     * List installed MCP servers
     */
    listMCPServers(): Promise<MCPInstalledServer[]>;
    /**
     * Uninstall an MCP server
     */
    uninstallMCPServer(name: string): Promise<void>;
    /**
     * Enable/disable an MCP server
     */
    toggleMCPServer(name: string, enabled: boolean): Promise<void>;
    /**
     * Execute a command via OpenClaude
     */
    executeCommand(command: string, timeout?: number): Promise<ExecuteResult>;
    /**
     * Enable Hestia integration - exposes Hestia tools as MCP servers
     */
    enableHestiaIntegration(options?: {
        backendUrl?: string;
        apiKey?: string;
        workspaceId?: string;
    }): Promise<void>;
    /**
     * Log activity to Hestia
     */
    logActivity(type: string, details: Record<string, unknown>): Promise<void>;
    private syncProfile;
    private mapProvider;
    private loadProfile;
    private saveProfile;
    private buildEnvironment;
    private buildArguments;
    private setupProcessHandlers;
    private cleanupProcess;
    private handleCrash;
    private waitForReady;
    private handleError;
}
export declare const openclaudeService: OpenClaudeService;
//# sourceMappingURL=openclaude-service.d.ts.map