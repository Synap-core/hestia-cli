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
  AIModel,
  EntityState,
  EveConfig,
  Credentials,
  DNAError,
  DockerCompose,
  DockerComposeService,
  Service,
  ServiceConfig,
} from './types.js';

// Managers
export { ConfigManager, configManager } from './config.js';
export { CredentialsManager, credentialsManager } from './credentials.js';
export { EntityStateManager, entityStateManager } from './entity-state.js';

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
} from './setup-profile.js';

export { type HardwareFacts, probeHardware, formatHardwareReport } from './hw-probe.js';

// Version
export const VERSION = '0.1.0';
