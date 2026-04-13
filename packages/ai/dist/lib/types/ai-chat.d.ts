/**
 * AI Chat Types - Type definitions for AI Chat UI services
 */
/**
 * Available AI chat UI providers
 * - lobechat: Modern UI with plugin ecosystem
 * - openwebui: Native Ollama integration
 * - librechat: ChatGPT-like interface
 */
export type AIChatProvider = "lobechat" | "openwebui" | "librechat";
/**
 * Configuration for a single AI chat provider
 */
export interface AIChatProviderConfig {
    /** Provider identifier */
    name: AIChatProvider;
    /** Whether the provider is currently enabled/running */
    enabled: boolean;
    /** Port the service runs on */
    port: number;
    /** Access URL for the service */
    url?: string;
    /** Additional provider-specific configuration */
    config?: Record<string, any>;
}
/**
 * AI Chat section of Hestia configuration
 */
export interface AIChatConfig {
    /** List of configured AI chat providers */
    providers: AIChatProviderConfig[];
    /** Default provider to use when not specified */
    defaultProvider?: AIChatProvider;
}
/**
 * Status information for an AI chat provider
 */
export interface AIChatProviderStatus {
    /** Provider identifier */
    provider: AIChatProvider;
    /** Display name */
    name: string;
    /** Whether the provider is installed */
    installed: boolean;
    /** Whether the service is currently running */
    running: boolean;
    /** Whether the service is accessible/responding */
    accessible: boolean;
    /** Port the service runs on */
    port: number;
    /** Access URL */
    url: string;
    /** Health status */
    health: "healthy" | "degraded" | "unhealthy";
    /** Error message if applicable */
    error?: string;
}
/**
 * Provider feature information for display
 */
export interface AIChatProviderInfo {
    /** Provider identifier */
    name: AIChatProvider;
    /** Display name */
    displayName: string;
    /** Short description */
    description: string;
    /** List of key features */
    features: string[];
    /** Description of ideal use case */
    bestFor: string;
    /** Default port */
    port: number;
}
/**
 * Backend configuration options
 */
export interface AIChatBackendConfig {
    /** Backend type */
    type: "ollama" | "openclaude" | "openrouter";
    /** Endpoint URL */
    endpoint: string;
    /** API key (if required) */
    apiKey?: string;
    /** Default model */
    model: string;
}
/**
 * Installation options
 */
export interface AIChatInstallOptions {
    /** Provider to install */
    provider: AIChatProvider;
    /** Custom port (uses default if not specified) */
    port?: number;
    /** Initial configuration */
    config?: Record<string, any>;
}
/**
 * Provider comparison for documentation
 */
export interface AIChatProviderComparison {
    /** Provider name */
    name: string;
    /** Key strengths */
    strengths: string[];
    /** Key weaknesses or limitations */
    limitations: string[];
    /** Ideal user profiles */
    idealFor: string[];
    /** Not recommended for */
    notRecommendedFor: string[];
    /** Setup complexity: simple/moderate/complex */
    setupComplexity: "simple" | "moderate" | "complex";
    /** Resource usage: low/medium/high */
    resourceUsage: "low" | "medium" | "high";
    /** Plugin support */
    plugins: boolean;
    /** Multi-model support */
    multiModel: boolean;
    /** Document/RAG support */
    documentSupport: boolean;
    /** Voice support */
    voiceSupport: boolean;
    /** Mobile support */
    mobileSupport: boolean;
    /** User management */
    userManagement: boolean;
}
//# sourceMappingURL=ai-chat.d.ts.map