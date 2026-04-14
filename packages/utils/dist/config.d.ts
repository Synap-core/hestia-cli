/**
 * eve CLI - Configuration Management
 *
 * Handles loading, validation, and saving of eve configuration.
 */
import type { eveConfig, PackageConfig, IntelligenceConfig } from "@eve/types";
export declare const defaultConfig: eveConfig;
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
    config: eveConfig;
    path: string;
}>;
export declare const getConfig: typeof loadConfig;
export declare function getConfigValue(customPath?: string): Promise<eveConfig>;
export declare function loadSystemConfig(): Promise<Partial<eveConfig>>;
export declare function mergeConfigs(...configs: Array<Partial<eveConfig> | undefined>): eveConfig;
export declare function saveConfig(config: eveConfig, customPath?: string): Promise<void>;
export declare function updateConfig(updates: Partial<eveConfig>, customPath?: string): Promise<eveConfig>;
export declare function getPackageConfig(config: eveConfig, packageName: string): PackageConfig | undefined;
export declare function setPackageConfig(config: eveConfig, packageName: string, packageConfig: PackageConfig): eveConfig;
export declare function getIntelligenceConfig(config: eveConfig): IntelligenceConfig | undefined;
export declare function setIntelligenceConfig(config: eveConfig, intelligenceConfig: IntelligenceConfig): eveConfig;
export declare function validateConfig(config: unknown): eveConfig;
export declare function configExists(customPath?: string): Promise<boolean>;
export declare function createInitialConfig(options: {
    hearthName: string;
    role?: "primary" | "backup";
    domain?: string;
    intelligence?: IntelligenceConfig;
    aiPlatform?: "opencode" | "openclaude" | "later";
}, customPath?: string): Promise<eveConfig>;
export declare function getConfigSummary(config: eveConfig): string;
export declare function expandEnvVars(str: string): string;
export declare function loadCredentials(configDir?: string): Promise<Record<string, string>>;
export declare function saveCredentials(credentials: Record<string, string>, configDir?: string): Promise<void>;
export declare function getCredential(key: string): Promise<string | undefined>;
export declare function setCredential(key: string, value: string): Promise<void>;
export { loadCredentials as getCredentials };
export type { eveConfig as UserConfig };
export type { eveConfig as Credentials };
export type ConfigPaths = ReturnType<typeof getConfigPaths>;
export type ConfigPath = string;
//# sourceMappingURL=config.d.ts.map