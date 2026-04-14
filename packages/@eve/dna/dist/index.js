// src/config.ts
import { promises as fs } from "fs";
import { join } from "path";
import { homedir } from "os";
import yaml from "js-yaml";
import { z } from "zod";
var OrganSchema = z.enum(["brain", "arms", "builder", "eyes", "legs"]);
var OrganConfigSchema = z.object({
  enabled: z.boolean(),
  autoStart: z.boolean(),
  port: z.number().optional(),
  environment: z.record(z.string()).optional()
});
var ConfigSchema = z.object({
  name: z.string().min(1),
  version: z.string().default("0.1.0"),
  aiModel: z.enum(["ollama", "none"]).default("none"),
  organs: z.record(OrganConfigSchema),
  settings: z.object({
    logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
    autoUpdate: z.boolean().default(true),
    defaultTimeout: z.number().default(3e4)
  }),
  createdAt: z.string().datetime().or(z.date()),
  updatedAt: z.string().datetime().or(z.date())
});
var defaultConfig = {
  version: "0.1.0",
  aiModel: "none",
  organs: {
    brain: { enabled: false, autoStart: false },
    arms: { enabled: false, autoStart: false },
    builder: { enabled: false, autoStart: false },
    eyes: { enabled: false, autoStart: false },
    legs: { enabled: false, autoStart: false }
  },
  settings: {
    logLevel: "info",
    autoUpdate: true,
    defaultTimeout: 3e4
  }
};
function ensureAllOrgans(organs) {
  const allOrgans = ["brain", "arms", "builder", "eyes", "legs"];
  const result = {};
  for (const organ of allOrgans) {
    result[organ] = {
      enabled: organs[organ]?.enabled ?? false,
      autoStart: organs[organ]?.autoStart ?? false,
      port: organs[organ]?.port,
      environment: organs[organ]?.environment
    };
  }
  return result;
}
var ConfigManager = class {
  config = null;
  /**
   * Get the path to the configuration directory
   */
  getConfigDir() {
    return join(homedir(), ".config", "eve");
  }
  /**
   * Get the full path to the configuration file
   */
  getConfigPath() {
    return join(this.getConfigDir(), "config.yaml");
  }
  /**
   * Ensure the configuration directory exists
   */
  async ensureConfigDir() {
    const configDir = this.getConfigDir();
    try {
      await fs.mkdir(configDir, { recursive: true });
    } catch (error) {
      throw new Error(`Failed to create config directory: ${error.message}`);
    }
  }
  /**
   * Load configuration from disk
   * Creates default config if none exists
   */
  async loadConfig() {
    try {
      await this.ensureConfigDir();
      const configPath = this.getConfigPath();
      try {
        const content = await fs.readFile(configPath, "utf-8");
        const parsed = yaml.load(content);
        const validated = ConfigSchema.parse(parsed);
        this.config = {
          ...validated,
          organs: ensureAllOrgans(validated.organs),
          createdAt: new Date(validated.createdAt),
          updatedAt: new Date(validated.updatedAt)
        };
        return this.config;
      } catch (readError) {
        if (readError.code === "ENOENT") {
          return this.createDefaultConfig("default-entity");
        }
        throw readError;
      }
    } catch (error) {
      throw new Error(`Failed to load config: ${error.message}`);
    }
  }
  /**
   * Create a new default configuration
   */
  async createDefaultConfig(name) {
    const now = /* @__PURE__ */ new Date();
    this.config = {
      ...defaultConfig,
      name,
      createdAt: now,
      updatedAt: now
    };
    await this.saveConfig(this.config);
    return this.config;
  }
  /**
   * Save configuration to disk
   */
  async saveConfig(config) {
    try {
      await this.ensureConfigDir();
      const configFile = {
        ...config,
        organs: ensureAllOrgans(config.organs),
        createdAt: config.createdAt.toISOString(),
        updatedAt: config.updatedAt.toISOString()
      };
      const content = yaml.dump(configFile, {
        indent: 2,
        lineWidth: -1,
        noRefs: true,
        sortKeys: false
      });
      await fs.writeFile(this.getConfigPath(), content, "utf-8");
      this.config = config;
    } catch (error) {
      throw new Error(`Failed to save config: ${error.message}`);
    }
  }
  /**
   * Update configuration with partial updates
   */
  async updateConfig(updates) {
    const current = await this.loadConfig();
    const updated = {
      ...current,
      ...updates,
      organs: updates.organs ? ensureAllOrgans({ ...current.organs, ...updates.organs }) : current.organs,
      updatedAt: /* @__PURE__ */ new Date()
    };
    await this.saveConfig(updated);
    return updated;
  }
  /**
   * Get current config without reloading
   */
  getCachedConfig() {
    return this.config;
  }
};
var configManager = new ConfigManager();

// src/credentials.ts
import { promises as fs2 } from "fs";
import { join as join2 } from "path";
import { homedir as homedir2 } from "os";
var CREDENTIALS_FILE_MODE = 384;
var CredentialsManager = class {
  credentials = null;
  credentialsPath = null;
  /**
   * Get the path to the credentials file
   */
  getCredentialsPath() {
    if (this.credentialsPath) {
      return this.credentialsPath;
    }
    return join2(homedir2(), ".config", "eve", "credentials");
  }
  /**
   * Set a custom credentials path (useful for testing)
   */
  setCredentialsPath(path2) {
    this.credentialsPath = path2;
  }
  /**
   * Ensure the credentials directory exists with proper permissions
   */
  async ensureCredentialsDir() {
    const credsDir = join2(homedir2(), ".config", "eve");
    try {
      await fs2.mkdir(credsDir, { recursive: true, mode: 448 });
    } catch (error) {
      if (error.code !== "EEXIST") {
        throw new Error(`Failed to create credentials directory: ${error.message}`);
      }
    }
  }
  /**
   * Load credentials from disk
   * Returns empty object if no credentials exist
   */
  async loadCredentials() {
    try {
      await this.ensureCredentialsDir();
      const credsPath = this.getCredentialsPath();
      try {
        const content = await fs2.readFile(credsPath, "utf-8");
        const parsed = JSON.parse(content);
        if (typeof parsed !== "object" || parsed === null) {
          throw new Error("Invalid credentials format");
        }
        this.credentials = parsed;
        return this.credentials;
      } catch (readError) {
        if (readError.code === "ENOENT") {
          this.credentials = {};
          return this.credentials;
        }
        if (readError instanceof SyntaxError) {
          throw new Error("Credentials file is corrupted (invalid JSON)");
        }
        throw readError;
      }
    } catch (error) {
      throw new Error(`Failed to load credentials: ${error.message}`);
    }
  }
  /**
   * Save credentials to disk with restricted permissions
   */
  async saveCredentials(creds) {
    try {
      await this.ensureCredentialsDir();
      const credsPath = this.getCredentialsPath();
      const content = JSON.stringify(creds, null, 2);
      await fs2.writeFile(credsPath, content, {
        encoding: "utf-8",
        mode: CREDENTIALS_FILE_MODE
      });
      try {
        await fs2.chmod(credsPath, CREDENTIALS_FILE_MODE);
      } catch {
      }
      this.credentials = creds;
    } catch (error) {
      throw new Error(`Failed to save credentials: ${error.message}`);
    }
  }
  /**
   * Get a single credential by key
   */
  async getCredential(key) {
    const creds = await this.loadCredentials();
    return creds[key];
  }
  /**
   * Set a single credential
   */
  async setCredential(key, value) {
    const creds = await this.loadCredentials();
    creds[key] = value;
    await this.saveCredentials(creds);
  }
  /**
   * Delete a single credential
   */
  async deleteCredential(key) {
    const creds = await this.loadCredentials();
    delete creds[key];
    await this.saveCredentials(creds);
  }
  /**
   * Check if a credential exists
   */
  async hasCredential(key) {
    const creds = await this.loadCredentials();
    return key in creds;
  }
  /**
   * List all credential keys (values are hidden)
   */
  async listCredentialKeys() {
    const creds = await this.loadCredentials();
    return Object.keys(creds);
  }
  /**
   * Clear all credentials (use with caution!)
   */
  async clearAll() {
    await this.saveCredentials({});
  }
  /**
   * Get cached credentials without reloading
   */
  getCachedCredentials() {
    return this.credentials;
  }
};
var credentialsManager = new CredentialsManager();

// src/entity-state.ts
import { readFile, writeFile, mkdir, access } from "fs/promises";
import { join as join3 } from "path";
import { homedir as homedir3, hostname } from "os";
import { z as z2 } from "zod";
var StateSchema = z2.object({
  version: z2.string(),
  initializedAt: z2.string(),
  aiModel: z2.enum(["ollama", "none"]),
  organs: z2.record(
    z2.enum(["brain", "arms", "builder", "eyes", "legs"]),
    z2.object({
      state: z2.enum(["missing", "installing", "ready", "error", "stopped"]),
      installedAt: z2.string().optional(),
      version: z2.string().optional(),
      lastChecked: z2.string().optional(),
      errorMessage: z2.string().optional()
    })
  ),
  metadata: z2.object({
    lastBootTime: z2.string().optional(),
    hostname: z2.string().optional(),
    platform: z2.string().optional(),
    arch: z2.string().optional()
  })
});
var ORGANS = ["brain", "arms", "builder", "eyes", "legs"];
var DEFAULT_STATE = {
  version: "0.1.0",
  initializedAt: (/* @__PURE__ */ new Date()).toISOString(),
  aiModel: "none",
  organs: {
    brain: { state: "missing" },
    arms: { state: "missing" },
    builder: { state: "missing" },
    eyes: { state: "missing" },
    legs: { state: "missing" }
  },
  metadata: {}
};
var EntityStateManager = class {
  state = null;
  statePath = null;
  getStatePath() {
    if (this.statePath) {
      return this.statePath;
    }
    return join3(homedir3(), ".local", "share", "hestia", "state.json");
  }
  async getState() {
    if (this.state) {
      return this.state;
    }
    const statePath = this.getStatePath();
    try {
      await access(statePath);
      const content = await readFile(statePath, "utf-8");
      const parsed = JSON.parse(content);
      const validated = StateSchema.parse(parsed);
      const mergedState = {
        ...validated,
        organs: {
          ...DEFAULT_STATE.organs,
          ...validated.organs
        }
      };
      this.state = mergedState;
      return mergedState;
    } catch (error) {
      if (error.code === "ENOENT") {
        const defaultState = this.createDefaultState();
        await this.saveState(defaultState);
        this.state = defaultState;
        return defaultState;
      }
      if (error instanceof z2.ZodError) {
        const dnaError2 = new Error(`Invalid state format: ${error.message}`);
        dnaError2.code = "INVALID_STATE";
        dnaError2.path = statePath;
        throw dnaError2;
      }
      if (error instanceof SyntaxError) {
        const dnaError2 = new Error(`Invalid state JSON: ${error.message}`);
        dnaError2.code = "INVALID_STATE";
        dnaError2.path = statePath;
        throw dnaError2;
      }
      const dnaError = new Error(`Failed to load state: ${error.message}`);
      dnaError.code = "STATE_LOAD_ERROR";
      dnaError.path = statePath;
      throw dnaError;
    }
  }
  async saveState(state) {
    const statePath = this.getStatePath();
    const stateDir = join3(homedir3(), ".local", "share", "hestia");
    try {
      await mkdir(stateDir, { recursive: true });
      StateSchema.parse(state);
      const json = JSON.stringify(state, null, 2);
      await writeFile(statePath, json, "utf-8");
      this.state = state;
    } catch (error) {
      if (error instanceof z2.ZodError) {
        const dnaError2 = new Error(`Invalid state: ${error.message}`);
        dnaError2.code = "INVALID_STATE";
        dnaError2.path = statePath;
        throw dnaError2;
      }
      const dnaError = new Error(`Failed to save state: ${error.message}`);
      dnaError.code = "STATE_SAVE_ERROR";
      dnaError.path = statePath;
      throw dnaError;
    }
  }
  async updateOrgan(organ, organState, options) {
    const state = await this.getState();
    const status = {
      state: organState,
      lastChecked: (/* @__PURE__ */ new Date()).toISOString()
    };
    if (organState === "ready" || organState === "error") {
      status.installedAt = (/* @__PURE__ */ new Date()).toISOString();
    }
    if (options?.version) {
      status.version = options.version;
    }
    if (options?.errorMessage && organState === "error") {
      status.errorMessage = options.errorMessage;
    }
    state.organs[organ] = status;
    await this.saveState(state);
  }
  async setAIModel(model) {
    const state = await this.getState();
    state.aiModel = model;
    await this.saveState(state);
  }
  async getOrganState(organ) {
    const state = await this.getState();
    return state.organs[organ] || { state: "missing" };
  }
  async isOrganReady(organ) {
    const status = await this.getOrganState(organ);
    return status.state === "ready";
  }
  async getReadyOrgans() {
    const state = await this.getState();
    return ORGANS.filter((organ) => state.organs[organ]?.state === "ready");
  }
  async getMissingOrgans() {
    const state = await this.getState();
    return ORGANS.filter((organ) => state.organs[organ]?.state === "missing");
  }
  async getErrorOrgans() {
    const state = await this.getState();
    return ORGANS.filter((organ) => state.organs[organ]?.state === "error");
  }
  calculateCompleteness(state) {
    const readyCount = ORGANS.filter((organ) => state.organs[organ]?.state === "ready").length;
    return Math.round(readyCount / ORGANS.length * 100);
  }
  async getCompleteness() {
    const state = await this.getState();
    return this.calculateCompleteness(state);
  }
  async getNextSteps() {
    const state = await this.getState();
    const steps = [];
    if (state.aiModel === "none") {
      steps.push("Configure AI model (run: hestia ai setup)");
    }
    for (const organ of ORGANS) {
      const organStatus = state.organs[organ];
      switch (organStatus.state) {
        case "missing":
          steps.push(`Install ${organ} (run: hestia install ${organ})`);
          break;
        case "error":
          steps.push(`Fix ${organ} error: ${organStatus.errorMessage || "Unknown error"}`);
          break;
        case "stopped":
          steps.push(`Start ${organ} (run: hestia start ${organ})`);
          break;
        case "installing":
          steps.push(`Wait for ${organ} installation to complete`);
          break;
      }
    }
    if (steps.length === 0) {
      steps.push("Entity is fully operational! \u{1F389}");
    }
    return steps;
  }
  async updateMetadata(updates) {
    const state = await this.getState();
    state.metadata = { ...state.metadata, ...updates };
    await this.saveState(state);
  }
  async recordBoot() {
    await this.updateMetadata({
      lastBootTime: (/* @__PURE__ */ new Date()).toISOString()
    });
  }
  async resetState() {
    const defaultState = this.createDefaultState();
    await this.saveState(defaultState);
  }
  createDefaultState() {
    return {
      ...DEFAULT_STATE,
      metadata: {
        platform: process.platform,
        arch: process.arch,
        hostname: hostname()
      }
    };
  }
};
var entityStateManager = new EntityStateManager();

// src/docker-compose-generator.ts
import * as yaml2 from "js-yaml";
import * as fs3 from "fs/promises";
import * as path from "path";

// src/types.ts
var SERVICE_REGISTRY = {
  // Brain Services
  synap: {
    image: "ghcr.io/synap/backend:latest",
    containerName: "eve-brain-synap",
    ports: ["4000:4000"],
    environment: {
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://eve:eve@eve-brain-postgres:5432/synap",
      REDIS_URL: "redis://eve-brain-redis:6379"
    },
    network: "eve-network",
    restart: "unless-stopped",
    dependsOn: ["eve-brain-postgres", "eve-brain-redis"]
  },
  ollama: {
    image: "ollama/ollama:latest",
    containerName: "eve-brain-ollama",
    ports: ["11434:11434"],
    volumes: ["ollama-models:/root/.ollama"],
    network: "eve-network",
    restart: "unless-stopped"
  },
  postgres: {
    image: "postgres:16-alpine",
    containerName: "eve-brain-postgres",
    environment: {
      POSTGRES_USER: "eve",
      POSTGRES_PASSWORD: "eve",
      POSTGRES_DB: "synap"
    },
    volumes: ["eve-brain-postgres-data:/var/lib/postgresql/data"],
    network: "eve-network",
    restart: "unless-stopped",
    healthCheck: {
      command: "pg_isready -U eve",
      interval: "10s",
      timeout: "5s",
      retries: 5
    }
  },
  redis: {
    image: "redis:7-alpine",
    containerName: "eve-brain-redis",
    volumes: ["eve-brain-redis-data:/data"],
    command: ["redis-server", "--appendonly", "yes"],
    network: "eve-network",
    restart: "unless-stopped",
    healthCheck: {
      command: "redis-cli ping",
      interval: "10s",
      timeout: "5s",
      retries: 5
    }
  },
  // Arms Services
  openclaw: {
    image: "ghcr.io/openclaw/openclaw:latest",
    containerName: "eve-arms-openclaw",
    ports: ["3000:3000"],
    environment: {
      OLLAMA_URL: "http://eve-brain-ollama:11434",
      DEFAULT_MODEL: "llama3.2"
    },
    volumes: ["eve-arms-openclaw-data:/data"],
    network: "eve-network",
    restart: "unless-stopped",
    dependsOn: ["eve-brain-ollama"]
  },
  // Builder Services (CLI tools - no containers by default)
  opencode: {
    image: "node:20-alpine",
    containerName: "eve-builder-opencode",
    network: "eve-network",
    restart: "no"
  },
  openclaude: {
    image: "node:20-alpine",
    containerName: "eve-builder-openclaude",
    network: "eve-network",
    restart: "no"
  },
  dokploy: {
    image: "node:20-alpine",
    containerName: "eve-builder-dokploy",
    network: "eve-network",
    restart: "no"
  },
  // Eyes Services
  rsshub: {
    image: "rsshub/rsshub:latest",
    containerName: "eve-eyes-rsshub",
    ports: ["1200:1200"],
    network: "eve-network",
    restart: "unless-stopped"
  },
  // Legs Services
  traefik: {
    image: "traefik:v3.0",
    containerName: "eve-legs-traefik",
    ports: ["80:80", "443:443", "8080:8080"],
    volumes: [
      "/var/run/docker.sock:/var/run/docker.sock:ro",
      "eve-legs-traefik-certs:/etc/traefik/acme.json"
    ],
    network: "eve-network",
    restart: "unless-stopped"
  },
  // Tunnel services (optional)
  cloudflared: {
    image: "cloudflare/cloudflared:latest",
    containerName: "eve-legs-cloudflared",
    network: "eve-network",
    restart: "unless-stopped"
  },
  pangolin: {
    image: "pangolin/pangolin:latest",
    containerName: "eve-legs-pangolin",
    network: "eve-network",
    restart: "unless-stopped"
  }
};
var DEFAULT_ENTITY_STATE = {
  version: "0.1.0",
  initializedAt: (/* @__PURE__ */ new Date()).toISOString(),
  aiModel: "none",
  organs: {
    brain: { state: "missing" },
    arms: { state: "missing" },
    builder: { state: "missing" },
    eyes: { state: "missing" },
    legs: { state: "missing" }
  },
  metadata: {}
};

// src/docker-compose-generator.ts
var DockerComposeGenerator = class {
  services = /* @__PURE__ */ new Map();
  envVars = /* @__PURE__ */ new Map();
  volumes = /* @__PURE__ */ new Set();
  /**
   * Add a single service to the docker-compose configuration
   * 
   * @param service - The service identifier from SERVICE_REGISTRY
   * @param config - Optional partial configuration to override defaults
   */
  addService(service, config) {
    const baseConfig = SERVICE_REGISTRY[service];
    if (!baseConfig) {
      throw new Error(`Unknown service: ${service}`);
    }
    const mergedConfig = {
      ...baseConfig,
      ...config,
      // Deep merge environment and volumes if provided
      environment: config?.environment ? { ...baseConfig.environment, ...config.environment } : baseConfig.environment,
      volumes: config?.volumes ?? baseConfig.volumes,
      dependsOn: config?.dependsOn ?? baseConfig.dependsOn
    };
    this.services.set(service, mergedConfig);
    if (mergedConfig.volumes) {
      for (const volume of mergedConfig.volumes) {
        const volumeName = volume.split(":")[0];
        if (!volumeName.startsWith("/") && !volumeName.startsWith("~")) {
          this.volumes.add(volumeName);
        }
      }
    }
  }
  /**
   * Add all brain services: synap, ollama, postgres, redis
   */
  addBrainServices() {
    const brainServices = ["postgres", "redis", "ollama", "synap"];
    for (const service of brainServices) {
      this.addService(service);
    }
  }
  /**
   * Add arms services: openclaw
   */
  addArmsServices() {
    const armsServices = ["openclaw"];
    for (const service of armsServices) {
      this.addService(service);
    }
  }
  /**
   * Add eyes services: rsshub
   */
  addEyesServices() {
    const eyesServices = ["rsshub"];
    for (const service of eyesServices) {
      this.addService(service);
    }
  }
  /**
   * Add legs services: traefik
   */
  addLegsServices() {
    const legsServices = ["traefik"];
    for (const service of legsServices) {
      this.addService(service);
    }
  }
  /**
   * Set an environment variable for substitution
   * Variables will be substituted in the format ${VAR} or $VAR
   * 
   * @param key - Environment variable name
   * @param value - Environment variable value
   */
  setEnvVar(key, value) {
    this.envVars.set(key, value);
  }
  /**
   * Set multiple environment variables at once
   * 
   * @param vars - Record of environment variables
   */
  setEnvVars(vars) {
    for (const [key, value] of Object.entries(vars)) {
      this.envVars.set(key, value);
    }
  }
  /**
   * Substitute environment variables in a string
   * Replaces ${VAR} or $VAR with the value from envVars or keeps as placeholder
   * 
   * @param str - String containing variable placeholders
   * @returns String with variables substituted
   */
  substituteEnvVars(str) {
    let result = str.replace(/\$\{(\w+)\}/g, (match, varName) => {
      if (this.envVars.has(varName)) {
        return this.envVars.get(varName);
      }
      return match;
    });
    result = result.replace(/\$(\w+)/g, (match, varName) => {
      if (this.envVars.has(varName)) {
        return this.envVars.get(varName);
      }
      return match;
    });
    return result;
  }
  /**
   * Apply environment variable substitution to service configuration
   * 
   * @param config - Service configuration
   * @returns Configuration with env vars substituted
   */
  applyEnvSubstitution(config) {
    const substituted = { ...config };
    if (substituted.image) {
      substituted.image = this.substituteEnvVars(substituted.image);
    }
    if (substituted.containerName) {
      substituted.containerName = this.substituteEnvVars(substituted.containerName);
    }
    if (substituted.environment) {
      substituted.environment = Object.fromEntries(
        Object.entries(substituted.environment).map(([key, value]) => [
          key,
          this.substituteEnvVars(value)
        ])
      );
    }
    if (substituted.volumes) {
      substituted.volumes = substituted.volumes.map(
        (vol) => this.substituteEnvVars(vol)
      );
    }
    if (substituted.command) {
      substituted.command = substituted.command.map(
        (cmd) => this.substituteEnvVars(cmd)
      );
    }
    if (substituted.healthCheck?.command) {
      substituted.healthCheck = {
        ...substituted.healthCheck,
        command: this.substituteEnvVars(substituted.healthCheck.command)
      };
    }
    return substituted;
  }
  /**
   * Convert ServiceConfig to DockerComposeService format
   * 
   * @param service - Service identifier
   * @param config - Service configuration
   * @returns DockerComposeService
   */
  toDockerComposeService(service, config) {
    const composeService = {
      image: config.image,
      container_name: config.containerName
    };
    if (config.ports && config.ports.length > 0) {
      composeService.ports = config.ports;
    }
    if (config.environment && Object.keys(config.environment).length > 0) {
      composeService.environment = config.environment;
    }
    if (config.volumes && config.volumes.length > 0) {
      composeService.volumes = config.volumes;
    }
    if (config.network) {
      composeService.networks = [config.network];
    }
    if (config.restart) {
      composeService.restart = config.restart;
    }
    if (config.command && config.command.length > 0) {
      composeService.command = config.command;
    }
    if (config.dependsOn && config.dependsOn.length > 0) {
      composeService.depends_on = config.dependsOn;
    }
    if (config.healthCheck) {
      composeService.healthcheck = {
        test: ["CMD-SHELL", config.healthCheck.command],
        interval: config.healthCheck.interval,
        timeout: config.healthCheck.timeout,
        retries: config.healthCheck.retries
      };
    }
    return composeService;
  }
  /**
   * Generate the complete Docker Compose object
   * 
   * @returns DockerCompose object
   */
  generate() {
    const services = {};
    const networks = {};
    const volumes = {};
    for (const [serviceName, serviceConfig] of this.services) {
      const substitutedConfig = this.applyEnvSubstitution(serviceConfig);
      services[serviceName] = this.toDockerComposeService(
        serviceName,
        substitutedConfig
      );
      if (substitutedConfig.network && !networks[substitutedConfig.network]) {
        networks[substitutedConfig.network] = {
          driver: "bridge"
        };
      }
    }
    if (Object.keys(networks).length === 0) {
      networks["eve-network"] = {
        driver: "bridge"
      };
    }
    for (const volumeName of this.volumes) {
      volumes[volumeName] = {};
    }
    return {
      version: "3.8",
      services,
      networks,
      volumes
    };
  }
  /**
   * Generate YAML string from the docker-compose configuration
   * 
   * @returns YAML formatted string
   */
  toYaml() {
    const compose = this.generate();
    return yaml2.dump(compose, {
      indent: 2,
      lineWidth: -1,
      // Don't wrap lines
      noRefs: true,
      // Don't use YAML references
      sortKeys: false
      // Keep original key order
    });
  }
  /**
   * Write docker-compose.yml to a file
   * 
   * @param filePath - Path to write the file
   */
  async toFile(filePath) {
    const yamlContent = this.toYaml();
    const dir = path.dirname(filePath);
    await fs3.mkdir(dir, { recursive: true });
    await fs3.writeFile(filePath, yamlContent, "utf-8");
  }
  /**
   * Check if a service is already added
   * 
   * @param service - Service identifier
   * @returns True if service is added
   */
  hasService(service) {
    return this.services.has(service);
  }
  /**
   * Remove a service from the configuration
   * 
   * @param service - Service identifier
   */
  removeService(service) {
    const config = this.services.get(service);
    if (config?.volumes) {
      for (const volume of config.volumes) {
        const volumeName = volume.split(":")[0];
        let volumeInUse = false;
        for (const [svcName, svcConfig] of this.services) {
          if (svcName !== service && svcConfig.volumes) {
            if (svcConfig.volumes.some((v) => v.startsWith(volumeName + ":"))) {
              volumeInUse = true;
              break;
            }
          }
        }
        if (!volumeInUse) {
          this.volumes.delete(volumeName);
        }
      }
    }
    this.services.delete(service);
  }
  /**
   * Get all added services
   * 
   * @returns Array of service identifiers
   */
  getServices() {
    return Array.from(this.services.keys());
  }
  /**
   * Get configuration for a specific service
   * 
   * @param service - Service identifier
   * @returns Service configuration or undefined
   */
  getServiceConfig(service) {
    return this.services.get(service);
  }
  /**
   * Clear all services and start fresh
   */
  clear() {
    this.services.clear();
    this.volumes.clear();
  }
};
function createDockerComposeGenerator() {
  return new DockerComposeGenerator();
}

// src/setup-profile.ts
import { readFile as readFile2, writeFile as writeFile3, mkdir as mkdir3, access as access2 } from "fs/promises";
import { dirname as dirname2, join as join4 } from "path";
import { homedir as homedir4 } from "os";
import { z as z3 } from "zod";
var SetupProfileKindSchema = z3.enum(["inference_only", "data_pod", "full"]);
var SetupProfileSchema = z3.object({
  version: z3.literal("1"),
  profile: SetupProfileKindSchema,
  updatedAt: z3.string(),
  domainHint: z3.string().optional(),
  hearthName: z3.string().optional(),
  source: z3.enum(["wizard", "usb_manifest", "cli"]).optional()
});
var USB_MANIFEST_PATHS = [
  "/opt/eve/profile.json",
  join4(homedir4(), ".eve", "usb-profile.json")
];
function eveDir(cwd) {
  return join4(cwd, ".eve");
}
function getSetupProfilePath(cwd = process.cwd()) {
  return join4(eveDir(cwd), "setup-profile.json");
}
async function readSetupProfile(cwd = process.cwd()) {
  const path2 = getSetupProfilePath(cwd);
  try {
    await access2(path2);
    const raw = JSON.parse(await readFile2(path2, "utf-8"));
    return SetupProfileSchema.parse(raw);
  } catch {
    return null;
  }
}
var UsbSetupManifestSchema = z3.object({
  version: z3.literal("1"),
  target_profile: SetupProfileKindSchema,
  hearth_name: z3.string().optional(),
  domain_hint: z3.string().optional()
});
async function readUsbSetupManifest() {
  const envPath = process.env.EVE_SETUP_MANIFEST?.trim();
  const paths = envPath ? [envPath, ...USB_MANIFEST_PATHS] : [...USB_MANIFEST_PATHS];
  for (const p of paths) {
    if (!p) continue;
    try {
      await access2(p);
      const raw = JSON.parse(await readFile2(p, "utf-8"));
      return UsbSetupManifestSchema.parse(raw);
    } catch {
      continue;
    }
  }
  return null;
}
async function writeSetupProfile(profile, cwd = process.cwd()) {
  const dir = eveDir(cwd);
  await mkdir3(dir, { recursive: true });
  const full = {
    version: "1",
    updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    ...profile
  };
  const parsed = SetupProfileSchema.parse(full);
  await writeFile3(getSetupProfilePath(cwd), JSON.stringify(parsed, null, 2), "utf-8");
}
async function writeUsbSetupManifest(manifest, outputPath) {
  const parsed = UsbSetupManifestSchema.parse(manifest);
  await mkdir3(dirname2(outputPath), { recursive: true });
  await writeFile3(outputPath, JSON.stringify(parsed, null, 2), "utf-8");
}

// src/hw-probe.ts
import { cpus, totalmem, platform, arch, hostname as hostname2 } from "os";
import { execFile } from "child_process";
import { promisify } from "util";
var execFileAsync = promisify(execFile);
async function probeHardware(runNvidiaSmi) {
  const cpuList = cpus() ?? [];
  const facts = {
    hostname: hostname2(),
    platform: platform(),
    arch: arch(),
    cpuCores: cpuList.length || 0,
    cpuModel: cpuList[0]?.model?.trim() ?? "unknown",
    totalMemoryBytes: totalmem(),
    totalMemoryGb: (totalmem() / 1024 ** 3).toFixed(1)
  };
  if (runNvidiaSmi) {
    try {
      const { stdout } = await execFileAsync("nvidia-smi", ["--query-gpu=name,memory.total", "--format=csv,noheader"], {
        timeout: 1e4
      });
      facts.nvidiaSmi = stdout.trim() || void 0;
    } catch {
      facts.nvidiaSmi = "(nvidia-smi not available or no GPU)";
    }
  }
  return facts;
}
function formatHardwareReport(f) {
  const lines = [
    `Hostname: ${f.hostname}`,
    `OS: ${f.platform} (${f.arch})`,
    `CPU: ${f.cpuModel} \u2014 ${f.cpuCores} logical cores`,
    `RAM: ${f.totalMemoryGb} GiB`
  ];
  if (f.nvidiaSmi !== void 0) {
    lines.push(`GPU: ${f.nvidiaSmi}`);
  }
  return lines.join("\n");
}

// src/index.ts
var VERSION = "0.1.0";
export {
  ConfigManager,
  CredentialsManager,
  DockerComposeGenerator,
  EntityStateManager,
  SetupProfileKindSchema,
  SetupProfileSchema,
  UsbSetupManifestSchema,
  VERSION,
  configManager,
  createDockerComposeGenerator,
  credentialsManager,
  entityStateManager,
  formatHardwareReport,
  getSetupProfilePath,
  probeHardware,
  readSetupProfile,
  readUsbSetupManifest,
  writeSetupProfile,
  writeUsbSetupManifest
};
