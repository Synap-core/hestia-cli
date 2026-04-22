import type { Task } from '@eve/dna';

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
   * Poll Synap for new/updated tasks.
   * Uses the entity router with filters: profileSlug=task, assignedAgentId=hermes.
   */
  async pollTasks(): Promise<TaskSyncResponse> {
    const url = new URL(`${this.config.apiUrl}/api/hub/entities`);
    url.searchParams.set('profileSlug', 'task');
    url.searchParams.set('assignedAgentId', 'hermes');
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
