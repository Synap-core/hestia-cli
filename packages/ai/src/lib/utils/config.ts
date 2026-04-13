// @ts-nocheck
/**
 * Hestia CLI - Configuration Management
 *
 * Handles loading, validation, and saving of Hestia configuration.
 */

import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import YAML from "yaml";
import { z } from "zod";
import type { HestiaConfig, PackageConfig, IntelligenceConfig } from "./types/index";

// Configuration schema for validation
const packageConfigSchema = z.object({
  enabled: z.boolean(),
  version: z.string().optional(),
  config: z.record(z.unknown()).optional(),
});

const intelligenceConfigSchema = z.object({
  provider: z.enum(["ollama", "openrouter", "anthropic", "openai", "custom"]),
  endpoint: z.string().url().optional(),
  apiKey: z.string().optional(),
  model: z.string(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().optional(),
});

const hearthConfigSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  role: z.enum(["primary", "backup"]).default("primary"),
  domain: z.string().optional(),
  reverseProxy: z.enum(["nginx", "traefik"]).default("nginx"),
});

// Database viewer configuration schema
const dbViewerConfigSchema = z.object({
  enabled: z.boolean().default(false),
  provider: z.enum(["whodb", "none"]).default("none"),
  port: z.number().int().min(1024).max(65535).default(8081),
  aiEnabled: z.boolean().default(false),
  databases: z.array(z.string()).default(["synap-postgres", "synap-redis"]),
});

// Tunnel configuration schema - for secure remote access via Pangolin
const tunnelConfigSchema = z.object({
  enabled: z.boolean().default(false),
  provider: z.enum(["pangolin", "cloudflare", "none"]).default("none"),
  mode: z.enum(["server", "client"]).optional(),
  serverUrl: z.string().url().optional(),
  token: z.string().optional(),
  publicUrl: z.string().url().optional(),
});

// AI Chat UI configuration schema
const aiChatProviderSchema = z.object({
  name: z.enum(["lobechat", "openwebui", "librechat"]),
  enabled: z.boolean(),
  port: z.number(),
  url: z.string().optional(),
  config: z.record(z.unknown()).optional(),
});

const aiChatConfigSchema = z.object({
  providers: z.array(aiChatProviderSchema),
  defaultProvider: z.enum(["lobechat", "openwebui", "librechat"]).optional(),
});

// Optional services configuration schema
const optionalServiceConfigSchema = z.object({
  enabled: z.boolean().default(false),
  installed: z.boolean().default(false),
  autoStart: z.boolean().default(true),
  ports: z.record(z.number()).optional(),
  environment: z.record(z.string()).optional(),
  volumeMounts: z.record(z.string()).optional(),
  customConfig: z.record(z.unknown()).optional(),
});

const podConfigSchema = z.object({
  url: z.string().url(),
  apiKey: z.string(),
  workspaceId: z.string().optional(),
});

const configSchema = z.object({
  version: z.string().default("1.0"),
  hearth: hearthConfigSchema,
  packages: z.record(packageConfigSchema),
  intelligence: intelligenceConfigSchema.optional(),
  reverseProxy: z.enum(["nginx", "traefik"]).default("nginx").optional(),
  pod: podConfigSchema.optional(),
  dbViewer: dbViewerConfigSchema.optional(),
  connectors: z
    .object({
      controlPlane: z
        .object({
          enabled: z.boolean().default(false),
          url: z.string().url(),
          token: z.string().optional(),
          role: z.enum(["primary", "backup", "fleet-member"]).optional(),
          backupHearths: z.array(z.string()).optional(),
          fleetId: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
  tunnel: tunnelConfigSchema.optional(),
  aiChat: aiChatConfigSchema.optional(),
  optionalServices: z.record(optionalServiceConfigSchema).optional(),
  aiPlatform: z.enum(["opencode", "openclaude", "later"]).optional(),
});

// Default optional services configuration
const defaultOptionalServices = {
  traefik: {
    enabled: false,
    installed: false,
    autoStart: true,
  },
  pangolin: {
    enabled: false,
    installed: false,
    autoStart: true,
  },
  whodb: {
    enabled: false,
    installed: false,
    autoStart: true,
  },
  lobechat: {
    enabled: false,
    installed: false,
    autoStart: true,
  },
  openwebui: {
    enabled: false,
    installed: false,
    autoStart: true,
  },
  librechat: {
    enabled: false,
    installed: false,
    autoStart: true,
  },
};

// Default configuration
export const defaultConfig: HestiaConfig = {
  version: "1.0",
  hearth: {
    id: "",
    name: "My Digital Hearth",
    role: "primary",
    reverseProxy: "nginx",
  },
  reverseProxy: "nginx",
  packages: {
    core: {
      enabled: true,
      version: "latest",
    },
    intelligence: {
      enabled: true,
      config: {
        provider: "ollama",
        endpoint: "http://localhost:11434",
        model: "llama3.1:8b",
      },
    },
    router: {
      enabled: true,
      config: {
        type: "caddy",
        tls: "automatic",
      },
    },
    monitor: {
      enabled: false,
    },
  },
  optionalServices: defaultOptionalServices,
  aiPlatform: undefined,
};

// Configuration paths
export function getConfigPaths() {
  const homeDir = os.homedir();
  const configDir = process.env.HESTIA_CONFIG_DIR || path.join(homeDir, ".hestia");
  const systemConfigDir = "/etc/hestia";

  return {
    configDir,
    systemConfigDir,
    userConfig: path.join(configDir, "config.yaml"),
    systemConfig: path.join(systemConfigDir, "config.yaml"),
    credentials: path.join(configDir, "credentials.yaml"),
    packagesDir: path.join(configDir, "packages"),
    registryCache: path.join(configDir, "registry-cache.yaml"),
  };
}

// Load configuration from files
export async function loadConfig(
  customPath?: string
): Promise<{ config: HestiaConfig; path: string }> {
  return await _loadConfig(customPath);
}

// Internal implementation
async function _loadConfig(
  customPath?: string
): Promise<{ config: HestiaConfig; path: string }> {
  const paths = getConfigPaths();
  const configPath = customPath || paths.userConfig;

  try {
    const content = await fs.readFile(configPath, "utf-8");
    const parsed = YAML.parse(content);
    const validated = configSchema.parse(parsed);

    return { config: validated as HestiaConfig, path: configPath };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      // Config file doesn't exist, return default
      return { config: { ...defaultConfig }, path: configPath };
    }
    if (error instanceof z.ZodError) {
      throw new Error(
        `Configuration validation failed:\n${error.errors
          .map((e) => `  - ${e.path.join(".")}: ${e.message}`)
          .join("\n")}`
      );
    }
    throw error;
  }
}

// Alias for loadConfig - used by commands
export const getConfig = loadConfig;

// Simplified getConfig that returns just the config object
export async function getConfigValue(customPath?: string): Promise<HestiaConfig> {
  const { config } = await loadConfig(customPath);
  return config;
}

// Load system configuration (if exists)
export async function loadSystemConfig(): Promise<Partial<HestiaConfig>> {
  const paths = getConfigPaths();

  try {
    const content = await fs.readFile(paths.systemConfig, "utf-8");
    const parsed = YAML.parse(content);
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

// Merge configurations (system < user < custom overrides)
export function mergeConfigs(
  ...configs: Array<Partial<HestiaConfig> | undefined>
): HestiaConfig {
  const merged = { ...defaultConfig };

  for (const config of configs) {
    if (!config) continue;

    // Merge top-level properties
    if (config.version) merged.version = config.version;
    if (config.hearth) merged.hearth = { ...merged.hearth, ...config.hearth };
    if (config.intelligence)
      merged.intelligence = { ...merged.intelligence, ...config.intelligence };
    if (config.aiPlatform !== undefined) merged.aiPlatform = config.aiPlatform;

    // Merge packages (deep merge)
    if (config.packages) {
      merged.packages = { ...merged.packages };
      for (const [name, pkgConfig] of Object.entries(config.packages)) {
        merged.packages[name] = {
          ...merged.packages[name],
          ...(pkgConfig as Record<string, unknown>),
        };
      }
    }

    // Merge connectors
    if (config.connectors) {
      merged.connectors = { ...merged.connectors, ...config.connectors };
    }

    // Merge tunnel config
    if (config.tunnel) {
      merged.tunnel = { ...merged.tunnel, ...config.tunnel };
    }

    // Merge optional services (deep merge)
    if (config.optionalServices) {
      merged.optionalServices = { ...merged.optionalServices };
      for (const [name, svcConfig] of Object.entries(config.optionalServices)) {
        merged.optionalServices[name] = {
          ...merged.optionalServices[name],
          ...(svcConfig as Record<string, unknown>),
        };
      }
    }

    // Merge AI platform
    if (config.aiPlatform !== undefined) {
      merged.aiPlatform = config.aiPlatform;
    }
  }

  return merged;
}

// Save configuration to file
export async function saveConfig(
  config: HestiaConfig,
  customPath?: string
): Promise<void> {
  const paths = getConfigPaths();
  const configPath = customPath || paths.userConfig;

  // Ensure config directory exists
  await fs.mkdir(path.dirname(configPath), { recursive: true });

  // Validate before saving
  const validated = configSchema.parse(config);

  // Serialize to YAML
  const yaml = YAML.stringify(validated, {
    indent: 2,
    lineWidth: 120,
    sortMapEntries: true,
  });

  await fs.writeFile(configPath, yaml, "utf-8");
}

// Update specific configuration section
export async function updateConfig(
  updates: Partial<HestiaConfig>,
  customPath?: string
): Promise<HestiaConfig> {
  const { config, path: configPath } = await loadConfig(customPath);
  const updated = mergeConfigs(config, updates);
  await saveConfig(updated, customPath || configPath);
  return updated;
}

// Get package configuration
export function getPackageConfig(
  config: HestiaConfig,
  packageName: string
): PackageConfig | undefined {
  return config.packages[packageName];
}

// Set package configuration
export function setPackageConfig(
  config: HestiaConfig,
  packageName: string,
  packageConfig: PackageConfig
): HestiaConfig {
  return {
    ...config,
    packages: {
      ...config.packages,
      [packageName]: packageConfig,
    },
  };
}

// Get intelligence configuration
export function getIntelligenceConfig(
  config: HestiaConfig
): IntelligenceConfig | undefined {
  return config.intelligence;
}

// Set intelligence configuration
export function setIntelligenceConfig(
  config: HestiaConfig,
  intelligenceConfig: IntelligenceConfig
): HestiaConfig {
  return {
    ...config,
    intelligence: intelligenceConfig,
  };
}

// Validate configuration
export function validateConfig(config: unknown): HestiaConfig {
  return configSchema.parse(config) as HestiaConfig;
}

// Check if configuration exists
export async function configExists(customPath?: string): Promise<boolean> {
  const paths = getConfigPaths();
  const configPath = customPath || paths.userConfig;

  try {
    await fs.access(configPath);
    return true;
  } catch {
    return false;
  }
}

// Create initial configuration
export async function createInitialConfig(
  options: {
    hearthName: string;
    role?: "primary" | "backup";
    domain?: string;
    intelligence?: IntelligenceConfig;
    aiPlatform?: "opencode" | "openclaude" | "later";
  },
  customPath?: string
): Promise<HestiaConfig> {
  const config: HestiaConfig = {
    version: "1.0",
    hearth: {
      id: generateHearthId(),
      name: options.hearthName,
      role: options.role || "primary",
      domain: options.domain,
    },
    packages: { ...defaultConfig.packages },
    intelligence: options.intelligence || defaultConfig.intelligence,
    aiPlatform: options.aiPlatform,
  };

  await saveConfig(config, customPath);
  return config;
}

// Generate unique hearth ID
function generateHearthId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `hearth-${timestamp}-${random}`;
}

// Get configuration summary for display
export function getConfigSummary(config: HestiaConfig): string {
  const lines = [
    `Hestia: ${config.hearth.name}`,
    `Role: ${config.hearth.role}`,
    `Domain: ${config.hearth.domain || "Not configured"}`,
    "",
    "Packages:",
  ];

  for (const [name, pkg] of Object.entries(config.packages)) {
    const pkgConfig = pkg as PackageConfig;
    const status = pkgConfig.enabled ? "✓" : "✗";
    const version = pkgConfig.version || "latest";
    lines.push(`  ${status} ${name} (${version})`);
  }

  if (config.intelligence) {
    lines.push(
      "",
      `Intelligence: ${config.intelligence.provider} (${config.intelligence.model})`
    );
  }

  if (config.connectors?.controlPlane?.enabled) {
    lines.push("", "Control Plane: Connected");
  }

  return lines.join("\n");
}

// Environment variable expansion
export function expandEnvVars(str: string): string {
  return str.replace(/\$\{([^}]+)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (match, p1, p2) => {
    const varName = p1 || p2;
    return process.env[varName] || match;
  });
}

// Load credentials from separate file
export async function loadCredentials(configDir?: string): Promise<Record<string, string>> {
  const paths = configDir
    ? { credentials: path.join(configDir, "credentials.yaml") }
    : getConfigPaths();

  try {
    const content = await fs.readFile(paths.credentials, "utf-8");
    return YAML.parse(content) || {};
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

// Save credentials
export async function saveCredentials(
  credentials: Record<string, string>,
  configDir?: string
): Promise<void> {
  const paths = configDir
    ? { configDir, credentials: path.join(configDir, "credentials.yaml") }
    : getConfigPaths();

  await fs.mkdir(paths.configDir, { recursive: true });

  const yaml = YAML.stringify(credentials, {
    indent: 2,
    sortMapEntries: true,
  });

  await fs.writeFile(paths.credentials, yaml, { mode: 0o600 }); // Restricted permissions
}

// Get credential
export async function getCredential(key: string): Promise<string | undefined> {
  const credentials = await loadCredentials();
  return credentials[key];
}

// Set credential
export async function setCredential(key: string, value: string): Promise<void> {
  const credentials = await loadCredentials();
  credentials[key] = value;
  await saveCredentials(credentials);
}

// Aliases for backward compatibility
export { loadCredentials as getCredentials };
export type { HestiaConfig as UserConfig };
export type { HestiaConfig as Credentials };

// Type for config paths
export type ConfigPaths = ReturnType<typeof getConfigPaths>;
export type ConfigPath = string;
