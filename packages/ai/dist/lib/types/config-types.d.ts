/**
 * Configuration Types
 */
export interface ConfigPaths {
    configDir: string;
    systemConfigDir: string;
    userConfig: string;
    systemConfig: string;
    credentials: string;
    packagesDir: string;
    registryCache: string;
}
export type ConfigPath = string;
export type UserConfig = import("./index.js").HestiaConfig;
export type Credentials = Record<string, string>;
//# sourceMappingURL=config-types.d.ts.map