/**
 * AI Chat Service - Manage AI Chat UI interfaces for Hestia
 *
 * Provides management for optional AI chat interfaces:
 * - LobeChat: Modern UI with plugin ecosystem
 * - Open WebUI: Native Ollama integration
 * - LibreChat: ChatGPT-like interface with multi-model support
 *
 * All services are optional and connect to Hestia's AI backend (Ollama/OpenClaude).
 */
import type { AIChatProvider, AIChatProviderStatus } from "../types.js";
export declare class AIChatService {
    private configPath;
    private dockerComposePath;
    constructor(configPath?: string);
    /**
     * Install a specific AI chat UI provider
     * Downloads the Docker image and configures the service
     */
    install(provider: AIChatProvider): Promise<void>;
    /**
     * Configure a specific AI chat UI with AI backend settings
     */
    configure(provider: AIChatProvider, config: Record<string, unknown>): Promise<void>;
    /**
     * Start a specific AI chat UI service
     */
    start(provider: AIChatProvider): Promise<void>;
    /**
     * Stop a specific AI chat UI service
     */
    stop(provider: AIChatProvider): Promise<void>;
    /**
     * Get status of a specific AI chat UI service
     */
    getStatus(provider: AIChatProvider): Promise<AIChatProviderStatus>;
    /**
     * Get access URL for a specific AI chat UI
     */
    getUrl(provider: AIChatProvider): Promise<string>;
    /**
     * List all installed AI chat UIs with their status
     */
    listInstalled(): Promise<AIChatProviderStatus[]>;
    /**
     * List all available AI chat UI providers (not just installed)
     */
    listAvailable(): Array<{
        name: AIChatProvider;
        displayName: string;
        description: string;
        features: string[];
        bestFor: string;
        port: number;
    }>;
    /**
     * Enable all AI chat UIs simultaneously
     */
    enableAll(): Promise<void>;
    /**
     * Remove a specific AI chat UI
     */
    remove(provider: AIChatProvider): Promise<void>;
    /**
     * Show logs for a specific AI chat UI
     */
    logs(provider: AIChatProvider, follow?: boolean): Promise<void>;
    /**
     * Connect AI chat UIs to a specific AI backend (Ollama/OpenClaude)
     */
    connectToAI(backend: "ollama" | "openclaude" | "openrouter"): Promise<void>;
    /**
     * Open AI chat UI in browser
     */
    open(provider: AIChatProvider): Promise<void>;
    /**
     * Check if docker-compose.yml includes AI chat services
     */
    private checkComposeIncludesAIChat;
    /**
     * Append AI chat services to docker-compose.yml
     */
    private appendAIChatToCompose;
    /**
     * Append environment variables to .env file
     */
    private appendEnvVars;
}
export declare const aiChatService: AIChatService;
//# sourceMappingURL=ai-chat-service.d.ts.map