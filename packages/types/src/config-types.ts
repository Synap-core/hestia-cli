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

// Alias for backward compatibility
export type UserConfig = import("./index.js").HestiaConfig;
export type Credentials = Record<string, string>;
