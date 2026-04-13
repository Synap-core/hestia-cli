/**
 * OpenClaw Integration Service
 *
 * Manages OpenClaw AI assistant integration for Hestia.
 * Handles installation, configuration, skill management, and communication platforms.
 *
 * OpenClaw is a stateful AI assistant framework that can be installed via npm (when published)
 * or git clone (for development/latest versions).
 */
import type { IntelligenceConfig } from "./types/index";
export type OpenClawInstallMethod = "npm" | "git";
export type OpenClawStatus = "not_installed" | "installing" | "installed" | "starting" | "running" | "stopping" | "stopped" | "error";
export type CommsPlatform = "telegram" | "whatsapp" | "discord" | "imessage";
export type SkillLanguage = "typescript" | "python" | "javascript";
export interface OpenClawConfig {
    version: string;
    installMethod: OpenClawInstallMethod;
    installPath: string;
    port: number;
    apiPort: number;
    intelligence: IntelligenceConfig;
    comms: Partial<Record<CommsPlatform, CommsPlatformConfig>>;
    skills: SkillMetadata[];
    hotReload: boolean;
    logLevel: "debug" | "info" | "warn" | "error";
    features: {
        proactiveMessages: boolean;
        memoryEnabled: boolean;
        toolsEnabled: boolean;
        webSearch: boolean;
    };
}
export interface CommsPlatformConfig {
    enabled: boolean;
    botToken?: string;
    apiKey?: string;
    webhookUrl?: string;
    phoneNumber?: string;
    channelId?: string;
    allowedUsers?: string[];
    autoReply: boolean;
}
export interface SkillMetadata {
    name: string;
    version: string;
    description: string;
    language: SkillLanguage;
    author?: string;
    tags: string[];
    entryPoint: string;
    configSchema?: Record<string, unknown>;
    enabled: boolean;
    installedAt: Date;
    lastUpdated: Date;
}
export interface SkillCode {
    metadata: SkillMetadata;
    code: string;
    config?: Record<string, unknown>;
}
export interface OpenClawActivity {
    id: string;
    timestamp: Date;
    type: "message" | "skill_call" | "tool_use" | "error" | "system";
    platform?: CommsPlatform;
    content: string;
    metadata?: Record<string, unknown>;
}
export interface OpenClawStatusInfo {
    status: OpenClawStatus;
    version?: string;
    pid?: number;
    uptime?: number;
    port: number;
    apiPort: number;
    lastError?: string;
    comms: Partial<Record<CommsPlatform, {
        connected: boolean;
        lastActivity?: Date;
    }>>;
    stats: {
        messagesReceived: number;
        messagesSent: number;
        skillsCalled: number;
        errors: number;
    };
}
export interface StartOptions {
    port?: number;
    apiPort?: number;
    foreground?: boolean;
    debug?: boolean;
}
export declare class OpenClawService {
    private process;
    private status;
    private openClawDir;
    private configPath;
    private skillsDir;
    private activityLog;
    private stats;
    private statusCheckInterval;
    constructor();
    /**
     * Install OpenClaw. Tries npm first, falls back to git clone.
     * @param options - Installation options
     * @returns The install method used
     */
    install(options?: {
        version?: string;
        method?: OpenClawInstallMethod;
        npmPackage?: string;
        gitUrl?: string;
    }): Promise<OpenClawInstallMethod>;
    private installViaNpm;
    private installViaGit;
    private createDefaultConfig;
    /**
     * Start the OpenClaw service
     * @param options - Start options
     */
    start(options?: StartOptions): Promise<void>;
    /**
     * Stop the OpenClaw service
     */
    stop(): Promise<void>;
    /**
     * Check if OpenClaw is currently running
     */
    isRunning(): Promise<boolean>;
    /**
     * Check if OpenClaw is installed
     */
    isInstalled(): Promise<boolean>;
    /**
     * Get current OpenClaw configuration
     */
    getConfig(): Promise<OpenClawConfig>;
    /**
     * Update OpenClaw configuration
     * @param config - Partial configuration to merge
     */
    configure(config: Partial<OpenClawConfig>): Promise<OpenClawConfig>;
    /**
     * Synchronize Hestia config with OpenClaw config
     * Translates Hestia intelligence settings to OpenClaw format
     */
    syncWithHestia(): Promise<void>;
    /**
     * Add a new skill to OpenClaw
     * @param name - Skill name (unique identifier)
     * @param code - Skill code and metadata
     */
    addSkill(name: string, code: SkillCode): Promise<SkillMetadata>;
    /**
     * Remove a skill from OpenClaw
     * @param name - Skill name to remove
     */
    removeSkill(name: string): Promise<void>;
    /**
     * List all installed skills
     */
    listSkills(): Promise<SkillMetadata[]>;
    /**
     * Get skill code
     * @param name - Skill name
     */
    getSkill(name: string): Promise<SkillCode | null>;
    /**
     * Update an existing skill
     * @param name - Skill name
     * @param updates - Partial updates
     */
    updateSkill(name: string, updates: Partial<Pick<SkillCode, "code" | "metadata" | "config">>): Promise<SkillMetadata>;
    /**
     * Enable or disable a skill
     * @param name - Skill name
     * @param enabled - Enable status
     */
    toggleSkill(name: string, enabled: boolean): Promise<SkillMetadata>;
    /**
     * Configure a communication platform (Telegram, WhatsApp, Discord, iMessage)
     * @param platform - Platform to configure
     * @param config - Platform configuration
     */
    configureComms(platform: CommsPlatform, config: Partial<CommsPlatformConfig>): Promise<void>;
    /**
     * Get communication platform status
     */
    getCommsStatus(): Promise<Record<CommsPlatform, {
        enabled: boolean;
        connected: boolean;
    }>>;
    /**
     * Test a communication platform connection
     * @param platform - Platform to test
     */
    testCommsConnection(platform: CommsPlatform): Promise<{
        success: boolean;
        message: string;
    }>;
    /**
     * Send a message to the OpenClaw assistant
     * @param message - Message content
     * @param options - Message options
     * @returns The assistant's response
     */
    sendMessage(message: string, options?: {
        platform?: CommsPlatform;
        userId?: string;
        chatId?: string;
        context?: Record<string, unknown>;
    }): Promise<{
        response: string;
        metadata?: Record<string, unknown>;
    }>;
    /**
     * Get recent activity log
     * @param limit - Maximum number of entries to return
     * @param type - Filter by activity type
     */
    getActivity(options?: {
        limit?: number;
        type?: OpenClawActivity["type"];
        since?: Date;
    }): Promise<OpenClawActivity[]>;
    /**
     * Get current status information
     */
    getStatus(): Promise<OpenClawStatusInfo>;
    private loadOpenClawConfig;
    private saveOpenClawConfig;
    private prepareEnvironment;
    private setupProcessHandlers;
    private waitForStartup;
    private checkPortInUse;
    private startStatusCheck;
    private callOpenClawAPI;
    private notifyConfigChange;
    private reloadSkills;
    private fetchCommsStatusFromAPI;
    private recordActivity;
    private getFileExtension;
}
/**
 * Singleton instance of OpenClawService
 * Use this for all OpenClaw operations
 */
export declare const openclawService: OpenClawService;
//# sourceMappingURL=openclaw-service.d.ts.map