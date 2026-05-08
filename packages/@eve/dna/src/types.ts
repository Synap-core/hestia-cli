/**
 * DNA Types - Core type definitions for Eve entity state and configuration
 * 
 * This file defines the complete type system for the Eve entity architecture,
 * including organs, services, configuration, and state management.
 */

// =============================================================================
// ORGAN TYPES
// =============================================================================

/** Represents the health/availability state of an organ */
export type OrganState = 'missing' | 'installing' | 'starting' | 'ready' | 'error' | 'stopped';

/** The available organs in the Eve ecosystem */
export type Organ = 'brain' | 'arms' | 'builder' | 'eyes' | 'legs';

/** Human-readable organ information */
export interface OrganInfo {
  name: string;
  emoji: string;
  description: string;
  purpose: string;
}

/** Organ metadata for display and documentation */
export const ORGAN_INFO: Record<Organ, OrganInfo> = {
  brain: {
    name: 'Brain',
    emoji: '🧠',
    description: 'Core intelligence and memory',
    purpose: 'Reasoning, memory, AI coordination',
  },
  arms: {
    name: 'Arms',
    emoji: '🦾',
    description: 'Action and tool use',
    purpose: 'Execute actions, use tools, integrate with external systems',
  },
  builder: {
    name: 'Builder',
    emoji: '🏗️',
    description: 'Creation and deployment',
    purpose: 'Generate code, create content, deploy applications',
  },
  eyes: {
    name: 'Eyes',
    emoji: '👁️',
    description: 'Perception and monitoring',
    purpose: 'Monitor feeds, observe changes, gather information',
  },
  legs: {
    name: 'Legs',
    emoji: '🦿',
    description: 'Exposure and routing',
    purpose: 'Route traffic, handle SSL, connect to internet',
  },
};

/** The state of a single organ */
export interface OrganStatus {
  state: OrganState;
  installedAt?: string;
  version?: string;
  lastChecked?: string;
  errorMessage?: string;
}

/** Individual organ configuration */
export interface OrganConfig {
  enabled: boolean;
  autoStart: boolean;
  port?: number;
  environment?: Record<string, string>;
}

// =============================================================================
// SERVICE TYPES
// =============================================================================

/** Available services organized by organ */
export type BrainService = 'synap' | 'ollama' | 'postgres' | 'redis' | 'kratos' | 'kratos-migrate';
export type ArmsService = 'openclaw';
export type BuilderService = 'opencode' | 'openclaude' | 'claudecode' | 'dokploy' | 'hermes';
export type EyesService = 'rsshub';
export type LegsService = 'traefik' | 'cloudflared' | 'pangolin' | 'newt';

export type Service = BrainService | ArmsService | BuilderService | EyesService | LegsService;

/** Maps services to their organs */
export const SERVICE_TO_ORGAN: Record<Service, Organ> = {
  synap: 'brain',
  ollama: 'brain',
  postgres: 'brain',
  redis: 'brain',
  kratos: 'brain',
  'kratos-migrate': 'brain',
  openclaw: 'arms',
  opencode: 'builder',
  openclaude: 'builder',
  claudecode: 'builder',
  dokploy: 'builder',
  hermes: 'arms',
  rsshub: 'eyes',
  traefik: 'legs',
  cloudflared: 'legs',
  pangolin: 'legs',
  newt: 'legs',
};

/** Service configuration for Docker containers */
export interface ServiceConfig {
  /** Docker image name */
  image: string;
  /** Container name (following eve-{organ}-{service} convention) */
  containerName: string;
  /** Exposed ports (host:container) */
  ports?: string[];
  /** Environment variables */
  environment?: Record<string, string>;
  /** Volume mounts (host:container) */
  volumes?: string[];
  /** Docker network name */
  network: string;
  /** Restart policy */
  restart?: 'no' | 'always' | 'unless-stopped' | 'on-failure';
  /** Health check command */
  healthCheck?: {
    command: string;
    interval: string;
    timeout: string;
    retries: number;
  };
  /** Command override */
  command?: string[];
  /** Entrypoint override */
  entrypoint?: string;
  /** Env files to load (docker compose env_file) */
  envFile?: string[];
  /** Dependencies that must be healthy before starting */
  dependsOn?: string[];
}

/** Complete service registry */
export const SERVICE_REGISTRY: Record<Service, ServiceConfig> = {
  // Brain Services
  synap: {
    image: 'ghcr.io/synap-core/backend:latest',
    containerName: 'eve-brain-synap',
    ports: ['4000:4000'],
    environment: {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://eve:eve@eve-brain-postgres:5432/synap',
      REDIS_URL: 'redis://eve-brain-redis:6379',
    },
    network: 'eve-network',
    restart: 'unless-stopped',
    dependsOn: ['eve-brain-postgres', 'eve-brain-redis'],
  },
  ollama: {
    image: 'ollama/ollama:latest',
    containerName: 'eve-brain-ollama',
    ports: ['11434:11434'],
    volumes: ['ollama-models:/root/.ollama'],
    network: 'eve-network',
    restart: 'unless-stopped',
  },
  postgres: {
    image: 'postgres:16-alpine',
    containerName: 'eve-brain-postgres',
    environment: {
      POSTGRES_USER: 'eve',
      POSTGRES_PASSWORD: 'eve',
      POSTGRES_DB: 'synap',
    },
    volumes: ['eve-brain-postgres-data:/var/lib/postgresql/data'],
    network: 'eve-network',
    restart: 'unless-stopped',
    healthCheck: {
      command: 'pg_isready -U eve',
      interval: '10s',
      timeout: '5s',
      retries: 5,
    },
  },
  redis: {
    image: 'redis:7-alpine',
    containerName: 'eve-brain-redis',
    volumes: ['eve-brain-redis-data:/data'],
    command: ['redis-server', '--appendonly', 'yes'],
    network: 'eve-network',
    restart: 'unless-stopped',
    healthCheck: {
      command: 'redis-cli ping',
      interval: '10s',
      timeout: '5s',
      retries: 5,
    },
  },
  // Kratos — identity & session management (required for pod auth)
  // Config dir is written by the install flow at $KRATOS_CONFIG_DIR.
  'kratos-migrate': {
    image: 'oryd/kratos:v1.3.1',
    containerName: 'eve-brain-kratos-migrate',
    environment: {
      DSN: '${KRATOS_DSN}',
    },
    command: ['migrate', 'sql', '-e', '--yes'],
    network: 'eve-network',
    dependsOn: ['eve-brain-postgres'],
  },
  kratos: {
    image: 'oryd/kratos:v1.3.1',
    containerName: 'eve-brain-kratos',
    environment: {
      DSN: '${KRATOS_DSN}',
      SECRETS_COOKIE: '${KRATOS_SECRETS_COOKIE}',
      SECRETS_CIPHER: '${KRATOS_SECRETS_CIPHER}',
      SERVE_PUBLIC_BASE_URL: 'https://${DOMAIN}/.ory/kratos/public/',
      SERVE_ADMIN_BASE_URL: 'http://eve-brain-kratos:4434',
      SELFSERVICE_DEFAULT_BROWSER_RETURN_URL: 'https://${DOMAIN}/admin/',
      SELFSERVICE_ALLOWED_RETURN_URLS: 'https://${DOMAIN},https://${DOMAIN}/*',
      IDENTITY_SCHEMAS_0_ID: 'default',
      IDENTITY_SCHEMAS_0_URL: 'file:///etc/config/kratos/identity.schema.json',
      KRATOS_WEBHOOK_SECRET: '${KRATOS_WEBHOOK_SECRET}',
      COURIER_SMTP_CONNECTION_URI: '${SMTP_CONNECTION_URI:-smtp://localhost:1025/}',
    },
    volumes: ['${KRATOS_CONFIG_DIR}:/etc/config/kratos'],
    command: ['serve', '-c', '/etc/config/kratos/kratos.yml', '--watch-courier'],
    network: 'eve-network',
    restart: 'unless-stopped',
    healthCheck: {
      command: 'wget -qO- http://localhost:4433/health/ready || exit 1',
      interval: '10s',
      timeout: '5s',
      retries: 5,
    },
    dependsOn: ['eve-brain-kratos-migrate'],
  },
  // Arms Services
  openclaw: {
    image: 'ghcr.io/openclaw/openclaw:latest',
    containerName: 'eve-arms-openclaw',
    ports: ['3000:3000'],
    environment: {
      OLLAMA_URL: 'http://eve-brain-ollama:11434',
      DEFAULT_MODEL: 'llama3.2',
    },
    volumes: ['eve-arms-openclaw-data:/data'],
    network: 'eve-network',
    restart: 'unless-stopped',
    dependsOn: ['eve-brain-ollama'],
  },
  // Builder Services (CLI tools - no containers by default)
  opencode: {
    image: 'node:20-alpine',
    containerName: 'eve-builder-opencode',
    network: 'eve-network',
    restart: 'no',
  },
  openclaude: {
    image: 'node:20-alpine',
    containerName: 'eve-builder-openclaude',
    network: 'eve-network',
    restart: 'no',
  },
  claudecode: {
    image: 'node:22-bookworm-slim',
    containerName: 'eve-builder-claudecode',
    network: 'eve-network',
    restart: 'no',
  },
  dokploy: {
    image: 'node:20-alpine',
    containerName: 'eve-builder-dokploy',
    network: 'eve-network',
    restart: 'no',
  },
  // Hermes — NousResearch headless AI agent (primary Eve agent provider).
  // Official image: nousresearch/hermes-agent:latest
  // HERMES_HOME=/opt/data is the working dir inside the container; we mount
  // ~/.eve/hermes from the host so config, plugins, and session state persist
  // across container restarts. The Synap memory provider plugin lives at
  // ~/.eve/hermes/plugins/memory/synap/ (written by Eve's install flow).
  hermes: {
    image: 'nousresearch/hermes-agent:latest',
    containerName: 'eve-builder-hermes',
    ports: ['8642:8642', '9119:9119', '9120:9120'],
    volumes: [
      '${HOME}/.eve/hermes:/opt/data', // HERMES_HOME — config + plugins + sessions
    ],
    environment: {
      HERMES_HOME: '/opt/data',
    },
    envFile: ['${HOME}/.eve/hermes.env'],
    network: 'eve-network',
    restart: 'unless-stopped',
    healthCheck: {
      command: 'curl -sf http://localhost:8642/health || exit 1',
      interval: '15s',
      timeout: '5s',
      retries: 3,
    },
  },
  // Eyes Services
  rsshub: {
    image: 'rsshub/rsshub:latest',
    containerName: 'eve-eyes-rsshub',
    ports: ['1200:1200'],
    network: 'eve-network',
    restart: 'unless-stopped',
  },
  // Legs Services
  traefik: {
    image: 'traefik:v3.0',
    containerName: 'eve-legs-traefik',
    ports: ['80:80', '443:443', '8080:8080'],
    volumes: [
      '/var/run/docker.sock:/var/run/docker.sock:ro',
      '/opt/traefik/traefik.yml:/etc/traefik/traefik.yml:ro',
      '/opt/traefik/dynamic:/etc/traefik/dynamic:ro',
      'eve-legs-traefik-certs:/etc/traefik/acme.json',
    ],
    network: 'eve-network',
    restart: 'unless-stopped',
  },
  // Tunnel services (optional)
  cloudflared: {
    image: 'cloudflare/cloudflared:latest',
    containerName: 'eve-legs-cloudflared',
    network: 'eve-network',
    restart: 'unless-stopped',
  },
  pangolin: {
    image: 'pangolin/pangolin:latest',
    containerName: 'eve-legs-pangolin',
    network: 'eve-network',
    restart: 'unless-stopped',
  },
  newt: {
    image: 'fosrl/newt:latest',
    containerName: 'eve-legs-newt',
    network: 'eve-network',
    restart: 'unless-stopped',
  },
};

// =============================================================================
// DOCKER TYPES
// =============================================================================

/** Docker Compose service definition */
export interface DockerComposeService {
  image: string;
  container_name: string;
  ports?: string[];
  environment?: Record<string, string>;
  env_file?: string[];
  volumes?: string[];
  networks?: string[];
  restart?: string;
  command?: string | string[];
  depends_on?: string[] | Record<string, { condition: string }>;
  healthcheck?: {
    test: string[];
    interval: string;
    timeout: string;
    retries: number;
  };
}

/** Docker Compose network definition */
export interface DockerComposeNetwork {
  driver: string;
  ipam?: {
    config: Array<{
      subnet: string;
    }>;
  };
}

/** Docker Compose volume definition */
export interface DockerComposeVolume {
  driver?: string;
}

/** Complete Docker Compose file structure */
export interface DockerCompose {
  version: string;
  services: Record<string, DockerComposeService>;
  networks: Record<string, DockerComposeNetwork>;
  volumes: Record<string, DockerComposeVolume>;
}

/** Docker container info (from docker ps) */
export interface ContainerInfo {
  id: string;
  names: string;
  image: string;
  status: string;
  state: string;
  ports: string;
  networks: string;
}

// =============================================================================
// AI TYPES
// =============================================================================

/** AI model preference */
export type AIModel = 'ollama' | 'none';

/** Ollama model information */
export interface OllamaModel {
  name: string;
  size: string;
  parameter_size?: string;
  quantization_level?: string;
  digest: string;
  modified_at: string;
}

/** AI provider configuration */
export interface AIConfig {
  provider: 'ollama' | 'openai' | 'anthropic';
  model: string;
  temperature: number;
  maxTokens: number;
  baseUrl?: string;
  apiKey?: string;
}

// =============================================================================
// ENTITY STATE TYPES
// =============================================================================

/** Ownership marker for installed components */
export type ManagedBy = 'eve' | 'synap' | 'manual';

/** Organ state as a status object */
export type OrganStateObj = {
  state: OrganState;
  installedAt?: string;
  version?: string;
  lastChecked?: string;
  errorMessage?: string;
};

/** A managed component entry in the v2 state */
export interface ComponentEntry {
  /** Organ mapping (legacy organ name, for backward compat) */
  organ?: Organ;
  /** Component state */
  state: OrganState;
  /** Version string */
  version?: string;
  /** ISO timestamp of installation */
  installedAt?: string;
  /** Last health-check timestamp */
  lastChecked?: string;
  /** Error details */
  errorMessage?: string;
  /** Who manages this component */
  managedBy?: ManagedBy;
  /** Component-specific config */
  config?: Record<string, unknown>;
}

/**
 * State v2 — component-centric model.
 *
 * v2 introduces the `installed` map keyed by component ID:
 *   traefik | synap | hermes | openclaw | ollama | dokploy | opencode | rsshub
 *
 * The legacy `organs` map is preserved for backward compat and
 * auto-migrated from the `installed` map on read.
 */
export interface EntityState {
  version: string;
  initializedAt: string;
  aiModel: AIModel;
  organs: Record<Organ, OrganStatus>;
  /** Component-centric state (v2+, nullable for v1 files) */
  installed?: Record<string, ComponentEntry>;
  /** Setup profile reference (v2+) */
  setupProfile?: SetupProfileV2;
  metadata: {
    lastBootTime?: string;
    hostname?: string;
    platform?: string;
    arch?: string;
    entityName?: string;
  };
}

/** Legacy setup profile kinds (from v1 binary profiles) */
export type LegacySetupProfileKind = 'inference_only' | 'data_pod' | 'full';

/** Setup profile v2 — replaces binary `profile` string with component array */
export interface SetupProfileV2 {
  version: 2;
  components: string[]; // component IDs
  installedAt: string;
  migratedFromV1?: LegacySetupProfileKind; // legacy profile kind if migrated
}

/** Entity state file schema (without methods) */
export interface EntityStateFile {
  organs: Record<Organ, OrganStatus>;
  aiModel: AIModel;
  createdAt: string;
  updatedAt: string;
  version: string;
}

// =============================================================================
// CONFIGURATION TYPES
// =============================================================================

/** Complete Eve configuration structure */
export interface EveConfig {
  /** The name of this Eve entity */
  name: string;
  
  /** Entity version */
  version: string;
  
  /** AI model preference */
  aiModel: AIModel;
  
  /** Organ-specific configurations */
  organs: Record<Organ, OrganConfig>;
  
  /** Global settings */
  settings: {
    /** Log level for all organs */
    logLevel: 'debug' | 'info' | 'warn' | 'error';
    
    /** Whether to check for updates automatically */
    autoUpdate: boolean;
    
    /** Default timeout for organ operations in ms */
    defaultTimeout: number;
    
    /** Domain configuration */
    domain?: {
      name: string;
      email: string;
      ssl: boolean;
    };
    
    /** Network configuration */
    network?: {
      name: string;
      subnet?: string;
    };
  };
  
  /** Timestamps */
  createdAt: Date;
  updatedAt: Date;
}

/** Configuration file schema (for serialization) */
export interface ConfigFile {
  name: string;
  version: string;
  aiModel: AIModel;
  organs: Record<Organ, OrganConfig>;
  settings: EveConfig['settings'];
  createdAt: string;
  updatedAt: string;
}

// =============================================================================
// CREDENTIAL TYPES
// =============================================================================

/** Stored credentials structure */
export interface Credentials {
  /** API keys and tokens */
  [key: string]: string;
}

/** Secret categories */
export interface Secrets {
  /** Database passwords */
  database: {
    postgres: string;
  };
  
  /** Authentication secrets */
  auth: {
    jwtSecret: string;
    sessionSecret: string;
    hubJwtSecret: string;
  };
  
  /** API keys */
  api: {
    hubProtocolApiKey: string;
    synapServiceEncryptionKey: string;
    openclawApiKey?: string;
  };
  
  /** External service keys */
  external?: {
    openai?: string;
    anthropic?: string;
    github?: string;
  };
}

// =============================================================================
// TASK TYPES
// =============================================================================

/** Task lifecycle status */
export type TaskStatus =
  | 'pending'
  | 'assigned'
  | 'in-progress'
  | 'reviewing'
  | 'done'
  | 'failed'
  | 'cancelled';

/** Task priority levels */
export type TaskPriority = 'low' | 'medium' | 'high' | 'critical';

/** Task type categories */
export type TaskType =
  | 'code-gen'
  | 'review'
  | 'deployment'
  | 'config'
  | 'maintenance'
  | 'data'
  | 'notification'
  | 'custom';

/** A task entity managed by the Hermes orchestrator */
export interface Task {
  id: string;
  title: string;
  description?: string;
  type: TaskType;
  status: TaskStatus;
  priority: TaskPriority;
  /** Agent slug assigned to this task (e.g., 'orchestrator', 'hermes') */
  assignedAgentId?: string;
  /** Synap entity ID this task is linked to */
  entityId?: string;
  /** Parent task ID (for subtasks) */
  parentId?: string;
  /** Template slug if generated from a template */
  templateSlug?: string;
  /** Arbitrary context payload */
  context?: Record<string, unknown>;
  /** Result data after completion */
  result?: Record<string, unknown>;
  metadata: {
    createdAt: string;
    updatedAt: string;
    startedAt?: string;
    completedAt?: string;
    deadline?: string;
    tags?: string[];
  };
}

/** Default Hermes configuration */
export const DEFAULT_HERMES_CONFIG = {
  enabled: true,
  pollIntervalMs: 30_000,
  maxConcurrentTasks: 1,
} as const;

// =============================================================================
// MESSENGING TYPES
// =============================================================================

/** Supported messaging platforms */
export type MessagingPlatform = 'telegram' | 'discord' | 'signal' | 'matrix';

/** Messaging platform configuration */
export interface MessagingConfig {
  enabled: boolean;
  platform: MessagingPlatform;
  botToken?: string;
  chatId?: string;
  username?: string;
  /** Max messages to process per poll */
  batchSize?: number;
}

// =============================================================================
// VOICE TYPES
// =============================================================================

/** Supported voice/telephony providers */
export type VoiceProvider = 'twilio' | 'signal' | 'selfhosted';

/** Voice/telephony configuration */
export interface VoiceConfig {
  enabled: boolean;
  provider: VoiceProvider;
  phoneNumber?: string;
  sipUri?: string;
  /** STT model for speech-to-text */
  sttModel?: string;
  /** TTS model for text-to-speech */
  ttsModel?: string;
}

// =============================================================================
// ERROR TYPES
// =============================================================================

/** DNA package error with code */
export interface DNAError extends Error {
  code?: string;
  path?: string;
  service?: string;
  organ?: Organ;
}

/** Error codes */
export type DNAErrorCode =
  | 'INVALID_STATE'
  | 'STATE_LOAD_ERROR'
  | 'STATE_SAVE_ERROR'
  | 'INVALID_CONFIG'
  | 'CONFIG_LOAD_ERROR'
  | 'CONFIG_SAVE_ERROR'
  | 'SERVICE_NOT_FOUND'
  | 'ORGAN_NOT_FOUND'
  | 'DOCKER_ERROR'
  | 'NETWORK_ERROR'
  | 'VOLUME_ERROR'
  | 'CREDENTIAL_ERROR';

// =============================================================================
// UTILITY TYPES
// =============================================================================

/** Health check result */
export interface HealthCheck {
  organ: Organ;
  service: Service;
  healthy: boolean;
  message?: string;
  lastChecked: string;
  responseTime?: number;
}

/** Entity completeness report */
export interface CompletenessReport {
  percentage: number;
  readyOrgans: Organ[];
  missingOrgans: Organ[];
  errorOrgans: Organ[];
  nextSteps: string[];
}

/** Command result */
export interface CommandResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: DNAError;
  message: string;
}

/** Installation options */
export interface InstallOptions {
  organ?: Organ;
  service?: Service;
  withAi?: boolean;
  model?: string;
  skipDeps?: boolean;
}

// =============================================================================
// CONSTANTS
// =============================================================================

/** Default entity state for initialization */
export const DEFAULT_ENTITY_STATE: EntityState = {
  version: '0.1.0',
  initializedAt: new Date().toISOString(),
  aiModel: 'none',
  organs: {
    brain: { state: 'missing' },
    arms: { state: 'missing' },
    builder: { state: 'missing' },
    eyes: { state: 'missing' },
    legs: { state: 'missing' },
  },
  metadata: {},
};

/** Default configuration */
export const DEFAULT_CONFIG: EveConfig = {
  name: 'eve',
  version: '0.1.0',
  aiModel: 'none',
  organs: {
    brain: { enabled: true, autoStart: true },
    arms: { enabled: true, autoStart: true },
    builder: { enabled: true, autoStart: false },
    eyes: { enabled: false, autoStart: false },
    legs: { enabled: true, autoStart: true },
  },
  settings: {
    logLevel: 'info',
    autoUpdate: false,
    defaultTimeout: 30000,
  },
  createdAt: new Date(),
  updatedAt: new Date(),
};

/** All organs array */
export const ORGANS: Organ[] = ['brain', 'arms', 'builder', 'eyes', 'legs'];

/** All services array */
export const SERVICES: Service[] = [
  'synap', 'ollama', 'postgres', 'redis',
  'openclaw',
  'opencode', 'openclaude', 'claudecode', 'dokploy', 'hermes',
  'rsshub',
  'traefik', 'cloudflared', 'pangolin', 'newt',
];
