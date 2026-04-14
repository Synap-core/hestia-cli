import { Command } from 'commander';

interface MCPConfig {
    command: string;
    args?: string[];
    env?: Record<string, string>;
}
interface OpenClawConfig {
    ollamaUrl: string;
    model?: string;
    synapApiUrl?: string;
    synapApiKey?: string;
    dokployApiUrl?: string;
    mcpServers?: Record<string, MCPConfig>;
}
declare class OpenClawService {
    private config;
    /**
     * Install OpenClaw container
     */
    install(): Promise<void>;
    /**
     * Configure OpenClaw to use Ollama
     */
    configure(ollamaUrl: string): Promise<void>;
    setIntegration(integration: {
        synapApiUrl?: string;
        synapApiKey?: string;
        dokployApiUrl?: string;
    }): void;
    /**
     * Start OpenClaw container
     */
    start(): Promise<void>;
    /**
     * Stop OpenClaw container
     */
    stop(): Promise<void>;
    /**
     * Check if OpenClaw is running
     */
    isRunning(): Promise<boolean>;
    /**
     * Install an MCP server
     */
    installMCPServer(name: string, config: MCPConfig): Promise<void>;
    /**
     * List installed MCP servers
     */
    listMCPServers(): Promise<string[]>;
    /**
     * Get OpenClaw status
     */
    getStatus(): Promise<{
        running: boolean;
        url: string;
        model: string;
    }>;
    /**
     * Run a Docker command and return output
     */
    private runDockerCommand;
}
declare const openclaw: OpenClawService;

declare function installCommand(program: Command): void;

declare function startCommand(program: Command): void;

declare function stopCommand(program: Command): void;

declare function mcpCommand(program: Command): void;

/**
 * Register Arms leaf commands on an existing `eve arms` Commander node
 */
declare function registerArmsCommands(arms: Command): void;
/** @deprecated Use registerArmsCommands on the `arms` subcommand */
declare function registerCommands(program: Command): void;

export { type MCPConfig, type OpenClawConfig, OpenClawService, installCommand, mcpCommand, openclaw, registerArmsCommands, registerCommands, startCommand, stopCommand };
