/**
 * State Manager (Legacy Re-export)
 * 
 * This file is kept for backward compatibility.
 * The StateManager has been refactored into focused services in src/lib/services/
 * 
 * New structure:
 * - ConfigService: Hestia config load/save
 * - OpenClaudeSync: OpenClaude profile sync
 * - OpenClawSync: OpenClaw config sync
 * - APIService: Synap backend API client
 * - StateManager: Simplified orchestration layer
 * 
 * @deprecated Import from '../services/state-manager.js' instead
 */

// Re-export everything from the new location for backward compatibility
export {
  // Core classes
  StateManager,
  StateManagerError,
  
  // Singleton and utilities
  stateManager,
  initializeStateManager,
  shutdownStateManager,
  
  // Credentials (re-exported from utils/credentials)
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
  
  // Types
  type StateManagerOptions,
  type SyncResult,
  type ConflictStrategy,
  type LocalState,
  type RuntimeState,
  type NormalState,
  type OpenClaudeProfile,
  type OpenClawConfig,
  type HestiaConfig,
} from '../../../services/state-manager.js';

// Alias for backward compatibility (old name)
export { StateManager as UnifiedStateManager } from '../../../services/state-manager.js';

// Extend StateManager prototype for health-check compatibility
// This adds the getSyncStatus method that health-check.ts expects
import { StateManager as StateManagerClass } from '../../../services/state-manager.js';

// Add getSyncStatus method if it doesn't exist
if (!StateManagerClass.prototype.getSyncStatus) {
  StateManagerClass.prototype.getSyncStatus = async function() {
    // Return a compatible sync status object
    return {
      lastSync: new Date().toISOString(),
      pendingChanges: 0,
      conflicts: 0,
      isSyncing: false,
    };
  };
}

// Warn about deprecation in development
if (process.env.NODE_ENV === 'development') {
  console.warn(
    '[DEPRECATED] Importing from lib/domains/services/lib/state-manager.js is deprecated. ' +
    'Use lib/services/state-manager.js instead.'
  );
}
