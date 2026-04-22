import process from 'node:process';
import { type Task } from '@eve/dna';
import { DEFAULT_HERMES_CONFIG } from '@eve/dna';
import { TaskPoller, type PollConfig, TransientError } from './task-poll.js';
import { TaskExecutor, type TaskExecutorConfig } from './task-executor.js';
import { TaskQueue } from './task-queue.js';

export type HermesStatus = 'idle' | 'polling' | 'running' | 'error' | 'stopping';

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
}

export interface HermesStats {
  tasksCompleted: number;
  tasksFailed: number;
  totalPolls: number;
  startTime: string;
  lastPoll?: string;
  lastTaskId?: string;
}

/**
 * Hermes daemon — the headless orchestrator that polls Synap for tasks
 * and dispatches them to the executor for processing.
 *
 * Flow: pollLoop → pollTasks → enqueue → dequeue → execute → submitResult
 * All communication with Synap goes through the TaskPoller (REST API).
 */
export class HermesDaemon {
  private config: HermesConfig;
  private poller: TaskPoller;
  private executor: TaskExecutor;
  private queue = new TaskQueue();
  private _status: HermesStatus = 'idle';
  private _stats: HermesStats = {
    tasksCompleted: 0,
    tasksFailed: 0,
    totalPolls: 0,
    startTime: new Date().toISOString(),
  };
  private _stopRequested = false;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private workingTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config?: Partial<HermesConfig>) {
    const resolved = { ...DEFAULT_HERMES_CONFIG, ...config };
    this.config = resolved as HermesConfig;
    this.poller = new TaskPoller({
      intervalMs: this.config.pollIntervalMs,
      maxRetries: 5,
      backoffMultiplier: 2,
      apiUrl: this.config.apiUrl,
      apiKey: this.config.apiKey,
    } as PollConfig);
    this.executor = new TaskExecutor({
      maxConcurrent: this.config.maxConcurrentTasks,
      workspaceDir: this.config.workspaceDir,
    } as TaskExecutorConfig);
  }

  get status(): HermesStatus {
    return this._status;
  }

  get isRunning(): boolean {
    return this._status === 'polling' || this._status === 'running';
  }

  get stats(): HermesStats {
    return { ...this._stats };
  }

  get queueSize(): number {
    return this.queue.size;
  }

  /**
   * Start the daemon loop.
   * Begins polling and processing tasks in the background.
   * Registers SIGINT/SIGTERM handlers for graceful shutdown.
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('[Hermes] Already running');
      return;
    }

    console.log('[Hermes] Starting daemon...');
    this._stopRequested = false;
    this._status = 'polling';

    // Start the main loop
    this._runLoop();

    // Register shutdown handlers
    const shutdown = (signal: string) => {
      console.log(`[Hermes] ${signal} received, shutting down...`);
      this.stop();
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    console.log(`[Hermes] Daemon started — polling every ${this.config.pollIntervalMs}ms`);
  }

  /**
   * Stop the daemon gracefully.
   * Finishes any currently running task, then exits the poll loop.
   */
  async stop(): Promise<void> {
    this._stopRequested = true;
    this._status = 'stopping';

    // Clear poll timer
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }

    // Clear working timer
    if (this.workingTimer) {
      clearTimeout(this.workingTimer);
      this.workingTimer = null;
    }

    // Wait for active tasks to finish (up to 30s)
    if (this.executor.activeCount > 0) {
      console.log('[Hermes] Waiting for active tasks to complete...');
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }

    this._status = 'idle';
    console.log('[Hermes] Daemon stopped. Stats:', JSON.stringify(this._stats));
  }

  /**
   * Restart the daemon (stop + start).
   */
  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  /**
   * Trigger a single poll (for debugging/one-shot use).
   */
  async pollOnce(): Promise<number> {
    this._stats.totalPolls++;
    this._stats.lastPoll = new Date().toISOString();
    try {
      const response = await this.poller.pollTasks();
      for (const task of response.tasks) {
        this.queue.enqueue(task);
      }
      return response.tasks.length;
    } catch (error) {
      if (error instanceof TransientError) {
        console.error(`[Hermes] Transient poll error: ${error.message}, backing off...`);
      } else {
        console.error(`[Hermes] Poll error: ${(error as Error).message}`);
      }
      return 0;
    }
  }

  /**
   * Main daemon loop.
   * Polls → enqueues tasks → processes queue → waits → repeats.
   */
  private async _runLoop(): Promise<void> {
    while (!this._stopRequested) {
      this._status = 'polling';

      // Poll for new tasks
      let taskCount = 0;
      try {
        taskCount = await this.pollOnce();
      } catch (error) {
        this._status = 'error';
        // Transient errors handled internally by poller with backoff
        const backoff = this.poller.getBackoffMs();
        if (backoff > 0) {
          await this._sleep(backoff);
          continue;
        }
      }

      if (taskCount > 0) {
        this._stats.lastPoll = new Date().toISOString();
      }

      // Process queued tasks
      this._status = 'running';
      await this._processQueue();

      if (this._stopRequested) break;

      // Wait for next poll cycle
      this._status = 'idle';
      await this._sleep(this.config.pollIntervalMs);
    }
  }

  /**
   * Process all queued tasks sequentially (respecting maxConcurrent).
   */
  private async _processQueue(): Promise<void> {
    while (!this.queue.isEmpty && !this._stopRequested && this.executor.activeCount < this.config.maxConcurrentTasks) {
      const task = this.queue.dequeue();
      if (!task) break;

      this._stats.lastTaskId = task.id;

      // Update task status on Synap
      await this.poller.updateTaskStatus(task.id, 'in-progress');

      try {
        const handle = this.executor.execute(task);
        const result = await handle.waitForCompletion();

        if (result.exitCode === 0) {
          this._stats.tasksCompleted++;
          // Submit result to Synap
          await this.poller.submitResult(task.id, {
            output: result.stdout,
            durationMs: result.durationMs,
          });
        } else {
          this._stats.tasksFailed++;
          await this.poller.updateTaskStatus(task.id, 'failed');
        }
      } catch (error) {
        this._stats.tasksFailed++;
        console.error(`[Hermes] Task ${task.id} failed: ${(error as Error).message}`);
        await this.poller.updateTaskStatus(task.id, 'failed');
      }
    }
  }

  private _sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      // Store reference so we can clear it on stop
      if (this._status === 'idle') {
        this.pollTimer = timer;
      } else {
        this.workingTimer = timer;
      }
    });
  }
}
