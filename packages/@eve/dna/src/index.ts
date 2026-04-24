/**
 * DNA Package - @eve/dna
 * 
 * Core infrastructure for Hestia CLI:
 * - Configuration management (EveConfig)
 * - Credentials storage
 * - Entity state tracking
 * - Organ health monitoring
 * - Docker Compose generation
 * 
 * @example
 * ```typescript
 * import { configManager, credentialsManager, entityStateManager } from '@eve/dna';
 * 
 * // Load configuration
 * const config = await configManager.loadConfig();
 * 
 * // Manage credentials
 * await credentialsManager.setCredential('api-key', 'secret123');
 * 
 * // Track entity state
 * await entityStateManager.updateOrgan('brain', 'ready');
 * const completeness = await entityStateManager.getCompleteness();
 * 
 * // Generate docker-compose.yml
 * import { DockerComposeGenerator } from '@eve/dna';
 * const generator = new DockerComposeGenerator();
 * generator.addBrainServices();
 * await generator.toFile('./docker-compose.yml');
 * ```
 */

// Types
export type {
  Organ,
  OrganState,
  OrganStatus,
  OrganInfo,
  AIModel,
  EntityState,
  ComponentEntry,
  ManagedBy,
  LegacySetupProfileKind,
  SetupProfileV2,
  EveConfig,
  Credentials,
  DNAError,
  DockerCompose,
  DockerComposeService,
  Service,
  ServiceConfig,
  Task,
  TaskStatus,
  TaskPriority,
  TaskType,
  MessagingPlatform,
  MessagingConfig,
  VoiceProvider,
  VoiceConfig,
} from './types.js';

// Constants
export { DEFAULT_HERMES_CONFIG } from './types.js';

// Managers
export { ConfigManager, configManager } from './config.js';
export { CredentialsManager, credentialsManager } from './credentials.js';
export { EntityStateManager, entityStateManager, migrateStateDirectory } from './entity-state.js';

// Docker Compose Generator
export { DockerComposeGenerator, createDockerComposeGenerator } from './docker-compose-generator.js';

// Setup profile (three-path Eve) + USB manifest + hardware facts
export {
  type SetupProfile,
  type SetupProfileKind,
  type UsbSetupManifest,
  readSetupProfile,
  readUsbSetupManifest,
  writeSetupProfile,
  writeUsbSetupManifest,
  getSetupProfilePath,
  SetupProfileSchema,
  SetupProfileKindSchema,
  UsbSetupManifestSchema,
  BuilderEngineSchema,
  AiModeSchema,
  AiProviderSchema,
  type BuilderEngine,
} from './setup-profile.js';

export { type HardwareFacts, probeHardware, formatHardwareReport } from './hw-probe.js';

export {
  type EveSecrets,
  readEveSecrets,
  writeEveSecrets,
  secretsPath,
  ensureSecretValue,
} from './secrets-contract.js';

export {
  DEFAULT_HUB_PATH,
  resolveHubBaseUrl,
  defaultSkillsDir,
  ensureEveSkillsLayout,
  writeBuilderProjectEnv,
  writeSandboxEnvFile,
  writeHermesEnvFile,
  copySynapSkillIntoClaudeProject,
  writeClaudeCodeSettings,
} from './builder-hub-wiring.js';

// Version
export const VERSION = '0.1.0';
