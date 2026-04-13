/**
 * Hestia CLI - Services
 *
 * High-level business logic services
 * All services implement clear interfaces for contract clarity and testability
 */

// ============================================================================
// Service Interfaces (Contracts)
// ============================================================================

export type {
  IConfigService,
  ICredentialsService,
  ISyncService,
  IAIService,
  IUSBService,
  IDockerService,
  ServiceStatus,
  USBDevice,
  ComposeConfig,
  ComposeServiceConfig,
  ComposeNetworkConfig,
  ComposeVolumeConfig,
  ServiceRegistry,
  ServiceFactory,
  ServiceProvider,
} from './interfaces.js';

// ============================================================================
// Refactored StateManager Services (v2)
// ============================================================================

export {
  ConfigService,
  configService,
  ConfigServiceError,
  loadConfig,
  saveConfig,
  updateConfig,
  getConfigPaths,
  type HestiaConfig,
} from './config-service.js';

export {
  OpenClaudeSync,
  OpenClaudeSyncError,
  loadOpenClaudeProfile,
  saveOpenClaudeProfile,
  translateToOpenClaude,
  getOpenClaudePaths,
  type OpenClaudeProfile,
} from './openclaude-sync.js';

export {
  OpenClawSync,
  OpenClawSyncError,
  loadOpenClawConfig,
  saveOpenClawConfig,
  translateToOpenClaw,
  getOpenClawPaths,
  type OpenClawConfig,
} from './openclaw-sync.js';

export {
  APIService,
  APIServiceError,
  createAPIClient,
  type NormalState,
  type HearthNode,
  type IntelligenceProvider,
  type PackageInstance,
  type APIServiceConfig,
} from './api-service.js';

export {
  StateManager,
  StateManagerError,
  stateManager,
  initializeStateManager,
  shutdownStateManager,
  loadCredentials,
  saveCredentials,
  getCredential,
  setCredential,
  removeCredential,
  listCredentials,
  hasCredential,
  validateCredential,
  getAllCredentials,
  clearAllCredentials,
  type StateManagerOptions,
  type SyncResult,
  type ConflictStrategy,
  type LocalState,
  type RuntimeState,
} from './state-manager.js';

// ============================================================================
// Docker Operations
// ============================================================================

export {
  startPackage,
  stopPackage,
  restartPackage,
  getPackageStatus,
  listContainers,
  getLogs,
  execInContainer,
  isDockerRunning,
  cleanup,
  getDockerInfo
} from './docker-service.js';

// Docker Service Class (implements IDockerService)
export { DockerService, dockerService } from './docker-service.js';

// Docker Compose Generation
export {
  generateDockerCompose
} from './docker-compose-generator.js';

// Environment Configuration
export {
  generateEnvFile
} from './env-generator.js';

// Domain Management
export {
  configureDomain,
  validateDomain,
  getSSLStatus
} from './domain-service.js';

// AI Services
export {
  openclaudeService
} from '../domains/ai/lib/openclaude-service.js';

export {
  aiChatService
} from '../domains/ai/lib/ai-chat-service.js';
