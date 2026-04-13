/**
 * Hestia CLI - Configuration Management
 *
 * Handles loading, validation, and saving of Hestia configuration.
 */
import type { HestiaConfig, PackageConfig, IntelligenceConfig } from "./types/index";
export declare const defaultConfig: HestiaConfig;
export declare function getConfigPaths(): {
    configDir: string;
    systemConfigDir: string;
    userConfig: string;
    systemConfig: string;
    credentials: string;
    packagesDir: string;
    registryCache: string;
};
export declare function loadConfig(customPath?: string): Promise<{
    config: HestiaConfig;
    path: string;
}>;
export declare const getConfig: typeof loadConfig;
export declare function getConfigValue(customPath?: string): Promise<HestiaConfig>;
export declare function loadSystemConfig(): Promise<Partial<HestiaConfig>>;
export declare function mergeConfigs(...configs: Array<Partial<HestiaConfig> | undefined>): HestiaConfig;
export declare function saveConfig(config: HestiaConfig, customPath?: string): Promise<void>;
export declare function updateConfig(updates: Partial<HestiaConfig>, customPath?: string): Promise<HestiaConfig>;
export declare function getPackageConfig(config: HestiaConfig, packageName: string): PackageConfig | undefined;
export declare function setPackageConfig(config: HestiaConfig, packageName: string, packageConfig: PackageConfig): HestiaConfig;
export declare function getIntelligenceConfig(config: HestiaConfig): IntelligenceConfig | undefined;
export declare function setIntelligenceConfig(config: HestiaConfig, intelligenceConfig: IntelligenceConfig): HestiaConfig;
export declare function validateConfig(config: unknown): HestiaConfig;
export declare function configExists(customPath?: string): Promise<boolean>;
export declare function createInitialConfig(options: {
    hearthName: string;
    role?: "primary" | "backup";
    domain?: string;
    intelligence?: IntelligenceConfig;
    aiPlatform?: "opencode" | "openclaude" | "later";
}, customPath?: string): Promise<HestiaConfig>;
export declare function getConfigSummary(config: HestiaConfig): string;
export declare function expandEnvVars(str: string): string;
export declare function loadCredentials(configDir?: string): Promise<Record<string, string>>;
export declare function saveCredentials(credentials: Record<string, string>, configDir?: string): Promise<void>;
export declare function getCredential(key: string): Promise<string | undefined>;
export declare function setCredential(key: string, value: string): Promise<void>;
export { loadCredentials as getCredentials };
export type { HestiaConfig as UserConfig };
export type { HestiaConfig as Credentials };
export type ConfigPaths = ReturnType<typeof getConfigPaths>;
export type ConfigPath = string;
//# sourceMappingURL=config.d.ts.map