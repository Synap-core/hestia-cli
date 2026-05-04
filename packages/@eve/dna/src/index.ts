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
  type AgentKeyRecord,
  type CodeEngine,
  DEFAULT_CODE_ENGINE,
  readEveSecrets,
  writeEveSecrets,
  readAgentKey,
  readAgentKeyOrLegacy,
  readAgentKeyOrLegacySync,
  writeAgentKey,
  readCodeEngine,
  writeCodeEngine,
  secretsPath,
  ensureSecretValue,
} from './secrets-contract.js';

// Agent registry — single source of truth for which Synap agents Eve
// provisions on the pod (eve, openclaw, hermes, openwebui-pipelines, coder).
export {
  type AgentInfo,
  type LegacyCoderEngineSlug,
  AGENTS,
  LEGACY_CODER_ENGINE_SLUGS,
  resolveAgent,
  allAgentTypes,
  agentsToProvision,
} from './agents.js';

// Background-task action registry mirror (canonical source: synap-backend)
export {
  type EveBackgroundTaskAction,
  EVE_BACKGROUND_ACTIONS,
  isValidEveBackgroundAction,
  listEveBackgroundActions,
  assigneeForAction,
} from './background-task-actions.js';

// Background-task wire shape (mirror of synap-backend's `background_tasks` schema).
export type {
  BackgroundTask,
  BackgroundTaskType,
  BackgroundTaskStatus,
} from './background-tasks-types.js';

export { getServerIp } from './server-ip.js';
export { type ServiceAccess, getAccessUrls } from './access-urls.js';

// Component registry — single source of truth for service identity
export {
  type ComponentInfo,
  type ServiceInfo,
  COMPONENTS,
  EVE_DASHBOARD_SERVICE,
  resolveComponent,
  allComponentIds,
  addonComponentIds,
  selectedIds,
  serviceComponents,
  publicComponentUrl,
  isLoopbackUrl,
  resolveSynapUrl,
  SYNAP_BACKEND_INTERNAL_URL,
} from './components.js';

// Centralized AI provider wiring
export {
  type WireAiResult,
  wireComponentAi,
  wireAllInstalledComponents,
  hasAnyProvider,
  pickPrimaryProvider,
  AI_CONSUMERS,
  AI_CONSUMERS_NEEDING_RECREATE,
} from './wire-ai.js';

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
