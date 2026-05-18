/**
 * Hermes daemon types — config and stats interfaces.
 *
 * The execution layer (poll loop, task queue, subprocess spawning) has been
 * retired. Hermes runs as a Python container (`eve-brain-hermes`); this file
 * retains only the shared config/stats shapes used by the CLI status command
 * and external consumers.
 */

export type HermesStatus = 'idle' | 'polling' | 'running' | 'error' | 'stopping';

/** A discovered personality — `users` rows whose parentAgentId == hermesUserId. */
export interface PersonalityRecord {
  userId: string;
  agentType: string;
  displayName: string;
}

export interface HermesConfig {
  enabled: boolean;
  pollIntervalMs: number;
  maxConcurrentTasks: number;
  /** Synap API URL (e.g. http://localhost:4000) */
  apiUrl: string;
  /** Synap API key for authentication */
  apiKey: string;
  /** Workspace directory for task artifacts */
  workspaceDir: string;
  /**
   * Hermes' OWN user ID on the pod (the orchestrator user). Required for
   * personality discovery — children of this user (parentAgentId == hermesUserId)
   * are the personalities Hermes can dispatch to. When unset, multi-personality
   * features are disabled.
   */
  hermesUserId?: string;
  /**
   * Full Hub base URL (e.g. https://pod.example.com/api/hub).
   * When unset, derived as `${apiUrl}/api/hub`.
   */
  hubBaseUrl?: string;
  /**
   * Default workspace ID for `agent_configs` lookups.
   */
  defaultWorkspaceId?: string;
  /**
   * Workspace ID used by FeaturePoller to scope devplane_feature queries.
   * @deprecated — pass workspaceId directly to FeaturePoller if scoping is needed.
   */
  featureWorkspaceId?: string;
  /**
   * List of plugin identifiers to activate.
   * Reserved for future external plugin loading.
   */
  plugins?: string[];
}

export interface HermesStats {
  tasksCompleted: number;
  tasksFailed: number;
  totalPolls: number;
  startTime: string;
  lastPoll?: string;
  lastTaskId?: string;
}
