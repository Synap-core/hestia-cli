/**
 * DNA Package - @hestia/dna
 * 
 * Core infrastructure for Hestia CLI:
 * - Configuration management (HestiaConfig)
 * - Credentials storage
 * - Entity state tracking
 * - Organ health monitoring
 * 
 * @example
 * ```typescript
 * import { configManager, credentialsManager, entityStateManager } from '@hestia/dna';
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
  AIModel,
  EntityState,
  HestiaConfig,
  Credentials,
  DNAError,
} from './types.js';

// Managers
export { ConfigManager, configManager } from './config.js';
export { CredentialsManager, credentialsManager } from './credentials.js';
export { EntityStateManager, entityStateManager } from './entity-state.js';

// Version
export const VERSION = '0.1.0';
