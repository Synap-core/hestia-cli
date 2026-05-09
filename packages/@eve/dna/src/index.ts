/**
 * DNA Package - @eve/dna
 * 
 * Core infrastructure for Hestia CLI:
 * - Configuration management (EveConfig)
 * - Credentials storage
 * - Entity state tracking
 * - Organ health monitoring
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
export { getEveStateHome, getEveStatePath, getEveEventsPath } from './state-paths.js';
export {
  appendOperationalEvent,
  readOperationalEvents,
  type ComponentDoctorMetadata,
  type ComponentHealth,
  type ComponentLifecycle,
  type ConfigConfidence,
  type ConfigSource,
  type DoctorCheck,
  type DoctorGroup,
  type DoctorStatus,
  type ExplainableValue,
  type MaterializerTarget,
  type NewOperationalEvent,
  type OperationalEvent,
  type OperationalEventType,
  type RepairKind,
  type RepairRequest,
  type RepairResult,
} from './operational.js';

export {
  redactSecrets,
  buildConfigDebugPayload,
  buildDiscoveryDebugPayload,
  buildMaterializedDebugPayload,
  buildEventsDebugPayload,
} from './debug-payloads.js';

export {
  type EveSecrets,
  type WiringStatus,
  type UnifiedProvider,
  type AgentKeyRecord,
  type CodeEngine,
  type PodIssuerKeyPair,
  type PodUserTokenRecord,
  type CpUserSession,
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
  readPodIssuer,
  ensurePodIssuer,
  readPodUserToken,
  writePodUserToken,
  clearPodUserToken,
  readCpUserSession,
  writeCpUserSession,
  clearCpUserSession,
  isCpSessionStale,
} from './secrets-contract.js';

// Centralized config store
export { configStore, type ConfigStore } from './config-store.js';

// Config change cascade
export { reconcile, type ReconcileOptions, type ReconcileResult } from './reconcile.js';

// Centralised channel credentials — durable secrets for Telegram, Discord,
// Slack, Signal, Matrix. WhatsApp is onboarded via the Agents browser app.
export {
  type ChannelPlatform,
  type ChannelCredentialInput,
  type ConfigureChannelOptions,
  type ConfigureChannelResult,
  type ChannelStatusEntry,
  configureChannel,
  disableChannel,
  readChannelStatus,
} from './channel-credentials.js';

// Channel credential validation — calls each platform's "who am I" endpoint
// before persistence so `eve arms messaging configure` refuses bad tokens.
export {
  validateChannelCredentials,
  type ChannelValidationResult,
  type ValidateChannelOptions,
} from './channel-validation.js';

// Doctor checks that assert Eve's centralized state is coherent end-to-end:
// providers, service routing, channels, wiring freshness, plus optional remote
// probes for Synap Hub reachability and OpenWebUI extras presence.
export {
  runStateCoherenceChecks,
  type StateCoherenceOptions,
} from './doctor-state-coherence.js';

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

// On-host HTTP transport — probes the loopback port published by Eve's
// docker-compose.override.yml (see synap-overrides.ts) and prefers it
// over the public Traefik URL when reachable. Use these from CLI
// runtime code, NOT for embedding URLs into other containers' env files
// (which want the pure `resolveSynapUrl` or `SYNAP_BACKEND_INTERNAL_URL`).
export {
  isSynapLoopbackReachable,
  resolveSynapUrlOnHost,
  resetSynapLoopbackProbeCache,
} from './loopback-probe.js';

// Dashboard-to-backend URL resolution — the dashboard's single source of
// truth for routing requests to the synap backend. Checks env var → loopback
// probe → Docker DNS → public domain. Designed for co-located dashboard
// runtime; does NOT require secrets.json.
export {
  type PodUrlResolutionDiagnostic,
  type PodUrlResolutionResult,
  type PodUrlResolutionSource,
  resolvePodUrl,
  resolvePodUrlDetailed,
  resetPodUrlCache,
} from './pod-url.js';

// Compose-override + image-prune helpers. Both the install recipe
// (@eve/brain `installSynapFromImage`) and the update flow
// (@eve/lifecycle `runUpdatePlan`) call these — pulling them up to
// @eve/dna sidesteps the @eve/brain ↔ @eve/lifecycle circular dep.
export {
  ensureSynapLoopbackOverride,
  type EnsureOverrideResult,
} from './synap-overrides.js';
export {
  pruneOldImagesForRepo,
  type PruneResult,
} from './image-prune.js';

// Centralized AI provider wiring
export {
  type WireAiResult,
  wireComponentAi,
  wireAllInstalledComponents,
  hasAnyProvider,
  pickPrimaryProvider,
  AI_CONSUMERS,
  AI_CONSUMERS_NEEDING_RECREATE,
  buildOpenwebuiModelSources,
  buildOpenwebuiManagedConfig,
  registerOpenwebuiAdminApi,
} from './wire-ai.js';

// OpenWebUI admin API client — JWT forging, config CRUD, pipelines, model sources
export {
  type AdminUser,
  type PipelineRegistration,
  type OpenWebuiConfig,
  type OpenwebuiStatus,
  type ModelSource,
  type ModelSourceMetadata,
  type OpenWebuiManagedConfig,
  type OpenWebuiConfigReconcileResult,
  getStatus,
  getAdminReadyStatus,
  getAdminJwt,
  getAdminJwtPostHealth,
  waitForHealth,
  getConfig,
  saveConfig,
  listPipelines,
  registerPipeline,
  listModelSources,
  registerModelSource,
  reconcileOpenwebuiManagedConfig,
  reconcileOpenwebuiManagedConfigViaAdmin,
  upsertAllModelSources,
} from './openwebui-admin.js';

export {
  ensureOpenWebuiBootstrapSecrets,
  writeOpenwebuiEnv,
  type OpenwebuiBootstrapResult,
  type WriteOpenwebuiEnvOptions,
  type WriteOpenwebuiEnvResult,
} from './openwebui-bootstrap.js';

// Push Synap surfaces into OpenWebUI: SKILL.md → Prompts, knowledge entries
// → Knowledge collection, Hub Protocol OpenAPI → external tool server.
export {
  pushSynapSkillsToOpenwebuiPrompts,
  type SkillsSyncResult,
  type SyncedSkillPrompt,
} from './openwebui-skills-sync.js';
export {
  syncSynapKnowledgeToOpenwebui,
  type KnowledgeSyncOptions,
  type KnowledgeSyncResult,
} from './openwebui-knowledge-sync.js';
export {
  registerSynapAsOpenwebuiToolServer,
  type ToolsSyncResult,
} from './openwebui-tools-sync.js';
export {
  syncOpenwebuiExtras,
  formatExtrasSummary,
  type OpenwebuiExtrasResult,
  type ExtrasOutcome,
  type SyncOpenwebuiExtrasOptions,
} from './openwebui-extras.js';

export {
  DEFAULT_HUB_PATH,
  resolveHubBaseUrl,
  defaultSkillsDir,
  ensureEveSkillsLayout,
  writeBuilderProjectEnv,
  writeSandboxEnvFile,
  writeHermesEnvFile,
  writeHermesConfigYaml,
  generateSynapPlugin,
  copySynapSkillIntoClaudeProject,
  writeClaudeCodeSettings,
} from './builder-hub-wiring.js';

// Pod config auto-discovery (reads on-disk .env / Traefik / docker inspect)
export {
  type DiscoveredPodConfig,
  type BackfilledPodConfig,
  type DiscoverAndBackfillPodConfigOptions,
  discoverPodConfig,
  discoverAndBackfillPodConfig,
  discoverAndBackfillPodUrl,
} from './discover.js';

// Shared Docker helpers — pod deploy-dir resolution, backend restart,
// Traefik network connect. Single source of truth used by lifecycle and
// preflight so container names and fallback strategies never drift.
export {
  POD_DEPLOY_DIR_CANDIDATES,
  findPodDeployDir,
  SYNAP_BACKEND_CONTAINERS,
  restartBackendContainer,
  restartHermesIfRunning,
  connectTraefikToEveNetwork,
  type ConnectTraefikResult,
} from './docker-helpers.js';

// Deploy pipeline
export type {
  DeployEnv,
  DeployParams,
  DeployResult,
  Framework,
  VercelConfig,
  AppConfig,
  CoolifyTarget,
  CoolifyApp,
  DockerPackResult,
  EveCredentials,
} from './deploy-types.js';
export {
  detectAppConfig,
  getAppImageName,
} from './app-detector.js';
export {
  buildAndPackageImage,
} from './docker-packager.js';
export {
  listCoolifyApps,
  findCoolifyAppByName,
  syncCoolifyAppImage,
  deployToCoolify,
  getCoolifyTargetsFromEnv,
  detectCoolifyEnvironments,
  detectCoolifyTargets,
} from './coolify-client.js';

// Version
export const VERSION = '0.1.0';
