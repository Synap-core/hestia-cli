import type { Task } from '@eve/dna';

/**
 * Subset of `agent_configs` row fields exposed via Hub REST.
 * Mirrors `synap-backend/packages/database/src/schema/agent-configs.ts`.
 * Read-only as far as the CLI is concerned.
 */
export interface AgentConfigOverrides {
  id: string;
  userId: string;
  workspaceId: string | null;
  agentType: string;
  promptAppend: string | null;
  extraToolIds: string[];
  disabledToolIds: string[];
  maxStepsOverride: number | null;
  modelOverride: string | null;
}

export interface PollConfig {
  /** Poll interval in ms */
  intervalMs: number;
  /** Max retries on transient errors */
  maxRetries: number;
  /** Backoff multiplier */
  backoffMultiplier: number;
  /** Synap API base URL */
  apiUrl: string;
  /** Synap API key */
  apiKey: string;
}

export interface TaskSyncResponse {
  tasks: Task[];
  since: string;
}

/**
 * Poller for tasks from Synap's entity router.
 * Queries entities with filter: type=task, assignedAgentId=hermes (or assigned=agent).
 */
export class TaskPoller {
  private config: PollConfig;
  private lastSince: string = '0';
  private retryCount = 0;
  private currentBackoff = 0;
  private _running = false;

  constructor(config: PollConfig) {
    this.config = config;
  }

  get running(): boolean {
    return this._running;
  }

  /**
   * Poll Synap for new/updated tasks for a single assigned agent.
   * Uses the entity router with filters: profileSlug=task, assignedAgentId=<id>.
   *
   * Defaults to 'hermes' for backwards compat. For multi-personality polling
   * pass the personality user ID. Note: `lastSince` is shared across all
   * assignees because the underlying cursor is monotonic across the event log.
   * The simple N+1 loop in HermesDaemon advances it once per cycle.
   */
  async pollTasks(assignedAgentId: string = 'hermes'): Promise<TaskSyncResponse> {
    const url = new URL(`${this.config.apiUrl}/api/hub/entities`);
    url.searchParams.set('profileSlug', 'task');
    url.searchParams.set('assignedAgentId', assignedAgentId);
    url.searchParams.set('since', this.lastSince);
    url.searchParams.set('limit', '50');

    try {
      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        const data = await response.json();
        this.retryCount = 0;
        this.currentBackoff = 0;
        this.lastSince = data.since || this.lastSince;
        return { tasks: data.tasks || [], since: data.since };
      }

      // Handle transient errors with backoff
      if (response.status === 429 || response.status >= 500) {
        this.retryCount++;
        this.currentBackoff = Math.min(
          this.config.intervalMs * Math.pow(this.config.backoffMultiplier, this.retryCount),
          5 * 60 * 1000, // Cap at 5 minutes
        );
        throw new TransientError(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Non-transient error
      throw new PollError(`HTTP ${response.status}: ${response.statusText}`);

    } catch (error) {
      if (error instanceof TransientError) {
        if (this.retryCount >= this.config.maxRetries) {
          throw new PollError(`Max retries (${this.config.maxRetries}) exceeded after transient error`);
        }
        throw error;
      }
      if (error instanceof PollError) throw error;
      throw new PollError(`Network error: ${(error as Error).message}`);
    }
  }

  /**
   * Poll for tasks across multiple assignees (orchestrator + personalities).
   * Implementation: N+1 fetch calls per cycle. Simple. Works on any pod with
   * the existing `/entities?assignedAgentId=...` endpoint.
   *
   * Upgrade path: when a `?assignedAgentIdIn=a,b,c` filter ships on the pod,
   * collapse this into a single call without changing the daemon-side API.
   */
  async pollTasksForMany(assignedAgentIds: string[]): Promise<TaskSyncResponse> {
    const aggregated: Task[] = [];
    let latestSince = this.lastSince;
    for (const id of assignedAgentIds) {
      const resp = await this.pollTasks(id);
      aggregated.push(...resp.tasks);
      if (resp.since && resp.since > latestSince) latestSince = resp.since;
    }
    return { tasks: aggregated, since: latestSince };
  }

  /**
   * Hub REST: list agents whose parentAgentId == userId.
   *
   * Response shape: `[{ id, name, agentType }]`. The backend deliberately
   * does NOT return the full agentMetadata blob — only the agentType slug
   * we need for routing.
   */
  async listChildAgents(parentUserId: string): Promise<Array<{
    id: string;
    name: string | null;
    agentType: string | null;
  }>> {
    const url = new URL(`${this.config.apiUrl}/api/hub/agent-users`);
    url.searchParams.set('parentUserId', parentUserId);
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
    });
    if (!response.ok) {
      throw new PollError(
        `listChildAgents failed: HTTP ${response.status} ${response.statusText}`,
      );
    }
    const data = (await response.json()) as Array<{
      id: string;
      name: string | null;
      agentType: string | null;
    }>;
    return data ?? [];
  }

  /** Hub REST: fetch agent_configs row for (userId, workspaceId, agentType). */
  async getAgentConfig(params: {
    userId: string;
    workspaceId?: string;
    agentType?: string;
  }): Promise<AgentConfigOverrides | null> {
    const url = new URL(`${this.config.apiUrl}/api/hub/agent-configs`);
    url.searchParams.set('userId', params.userId);
    if (params.workspaceId) url.searchParams.set('workspaceId', params.workspaceId);
    if (params.agentType) url.searchParams.set('agentType', params.agentType);
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
    });
    if (!response.ok) {
      // 403 or 404 → no config; surface as null rather than throw to keep the
      // dispatch path tolerant. Real auth bugs will surface via logs.
      return null;
    }
    const rows = (await response.json()) as AgentConfigOverrides[];
    if (!Array.isArray(rows) || rows.length === 0) return null;
    return rows[0];
  }

  /** Submit task result back to Synap. */
  async submitResult(taskId: string, result: Record<string, unknown>): Promise<boolean> {
    const url = `${this.config.apiUrl}/api/hub/entities/tasks/${taskId}`;
    try {
      const response = await fetch(url, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ result, status: 'done' }),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /** Update task status on Synap. */
  async updateTaskStatus(taskId: string, status: Task['status']): Promise<boolean> {
    const url = `${this.config.apiUrl}/api/hub/entities/tasks/${taskId}`;
    try {
      const response = await fetch(url, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status }),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /** Wait for backoff period (used by daemon loop). */
  getBackoffMs(): number {
    return this.currentBackoff;
  }

  resetCursor(): void {
    this.lastSince = '0';
    this.retryCount = 0;
    this.currentBackoff = 0;
  }

  /** Create a Synap memory note with the given content. Best-effort — returns false on failure. */
  async createMemoryNote(params: {
    userId?: string;
    content: string;
    metadata?: Record<string, unknown>;
  }): Promise<boolean> {
    try {
      const res = await fetch(`${this.config.apiUrl}/api/hub/entities`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          profileSlug: 'note',
          content: params.content,
          ...(params.userId ? { userId: params.userId } : {}),
          metadata: params.metadata ?? {},
        }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}

export class PollError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PollError';
  }
}

export class TransientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransientError';
  }
}
