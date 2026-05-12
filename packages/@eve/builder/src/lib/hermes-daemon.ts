import process from 'node:process';
import { type BackgroundTask, type Task, readEveSecrets } from '@eve/dna';
import { DEFAULT_HERMES_CONFIG } from '@eve/dna';
import {
  TaskPoller,
  type PollConfig,
  TransientError,
} from './task-poll.js';
import { VoiceTranscriber, type WhisperModelSize } from './voice-transcriber.js';
import {
  TaskExecutor,
  type TaskExecutorConfig,
  type ResolvedPersonality,
} from './task-executor.js';
import { TaskQueue } from './task-queue.js';
import { IntentPoller } from './intent-poll.js';
import { FeaturePoller } from './feature-poll.js';

export type HermesStatus = 'idle' | 'polling' | 'running' | 'error' | 'stopping';

/** A discovered personality — `users` rows whose parentAgentId == hermesUserId. */
export interface PersonalityRecord {
  userId: string;
  agentType: string;
  displayName: string;
}

/** TTL for the personality cache (5 minutes). */
const PERSONALITY_CACHE_TTL_MS = 5 * 60 * 1000;

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
   * features are disabled and only the legacy `assignedAgentId='hermes'` slug
   * polling runs.
   */
  hermesUserId?: string;
  /**
   * Default workspace ID for `agent_configs` lookups. Each task can override
   * via `task.context.workspaceId`; this is the fallback. If both are absent
   * the lookup returns the first row matching (userId, agentType) across all
   * workspaces — fine for single-workspace deployments.
   */
  defaultWorkspaceId?: string;
  /**
   * Workspace ID used by FeaturePoller to scope devplane_feature queries.
   * When absent, feature polling is disabled.
   */
  featureWorkspaceId?: string;
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
  private intentPoller: IntentPoller;
  private featurePoller: FeaturePoller | null = null;
  private executor: TaskExecutor;
  private queue = new TaskQueue();
  /**
   * Map from synthetic Task id (`intent:${row.id}`) → source background-
   * task row. Populated when the daemon enqueues an intent-derived Task,
   * consumed when that Task completes so we know which row to PATCH.
   */
  private intentSources = new Map<string, BackgroundTask>();
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
  /** Personality cache. Refreshed on TTL expiry or `refreshPersonalities()`. */
  private personalityCache: PersonalityRecord[] = [];
  private personalityCacheLoadedAt = 0;
  /** Map of personality userId → PersonalityRecord for O(1) dispatch lookup. */
  private personalityById = new Map<string, PersonalityRecord>();
  /** Map of personality agentType slug → PersonalityRecord. Pipeline tasks use slugs, not UUIDs. */
  private personalityByAgentType = new Map<string, PersonalityRecord>();

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
    this.intentPoller = new IntentPoller({
      apiUrl: this.config.apiUrl,
      apiKey: this.config.apiKey,
    });
    if (this.config.featureWorkspaceId) {
      this.featurePoller = new FeaturePoller({
        apiBase: this.config.apiUrl,
        apiKey: this.config.apiKey,
        workspaceId: this.config.featureWorkspaceId,
        queue: this.queue,
        pollIntervalMs: this.config.pollIntervalMs,
      });
    } else {
      console.debug('[Hermes] featureWorkspaceId not set — feature polling disabled');
    }
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
   * Discover the personalities this Hermes orchestrator owns.
   *
   * Implementation: GET /api/hub/agent-users?parentUserId=:hermesUserId.
   * (Option B in the plan — extended the existing /agent-users endpoint
   * with a parentUserId filter rather than adding a new route.)
   *
   * Auth: Hermes uses its own API key. The Hub guards `parentUserId` to
   * match the authenticated user, so Hermes can only see its own children.
   *
   * Caches the result; refresh via `refreshPersonalities()` or wait for TTL.
   */
  async discoverPersonalities(): Promise<PersonalityRecord[]> {
    const fresh =
      this.personalityCacheLoadedAt > 0 &&
      Date.now() - this.personalityCacheLoadedAt < PERSONALITY_CACHE_TTL_MS;
    if (fresh) {
      return this.personalityCache;
    }
    if (!this.config.hermesUserId && !this.config.defaultWorkspaceId) {
      // Neither orchestrator userId nor workspace configured — personality mode disabled.
      this.personalityCache = [];
      this.personalityCacheLoadedAt = Date.now();
      this.personalityById.clear();
      this.personalityByAgentType.clear();
      return [];
    }
    try {
      let rows: Array<{ id: string; name: string | null; agentType: string | null }> = [];

      if (this.config.hermesUserId) {
        rows = await this.poller.listChildAgents(this.config.hermesUserId);
      }

      // When no child agents found (Phase 1: personalities provisioned as workspace
      // members rather than parentAgentId children), fall back to workspace discovery.
      if (rows.length === 0 && this.config.defaultWorkspaceId) {
        const wsRows = await this.poller.listWorkspaceAgentUsers(this.config.defaultWorkspaceId);
        rows = wsRows.filter((r) => r.agentType !== null);
      }

      const records: PersonalityRecord[] = rows.map((row) => ({
        userId: row.id,
        agentType: typeof row.agentType === 'string' ? row.agentType : 'meta',
        displayName: row.name ?? row.id,
      }));
      this.personalityCache = records;
      this.personalityCacheLoadedAt = Date.now();
      this.personalityById = new Map(records.map((r) => [r.userId, r]));
      this.personalityByAgentType = new Map(records.map((r) => [r.agentType, r]));
      return records;
    } catch (err) {
      console.error(
        `[Hermes] discoverPersonalities failed: ${(err as Error).message}`,
      );
      // On failure, keep stale cache but DON'T reset the timestamp — we want a
      // retry on the next poll cycle.
      return this.personalityCache;
    }
  }

  /** Force a personality cache refresh on the next call. */
  refreshPersonalities(): void {
    this.personalityCacheLoadedAt = 0;
  }

  /**
   * Trigger a single poll (for debugging/one-shot use).
   *
   * Polls tasks for Hermes itself + every discovered personality. Implementation:
   * N+1 calls per cycle (one per assignee). Upgrade path: a single Hub
   * endpoint accepting `assignedAgentIdIn=...` collapses this without
   * touching the daemon-side API.
   */
  async pollOnce(): Promise<number> {
    this._stats.totalPolls++;
    this._stats.lastPoll = new Date().toISOString();

    // Refresh personalities on TTL — cheap and keeps dispatch routing correct.
    const personalities = await this.discoverPersonalities();
    const assigneeIds: string[] = ['hermes'];
    for (const p of personalities) assigneeIds.push(p.userId);

    let entityCount = 0;
    try {
      const response = await this.poller.pollTasksForMany(assigneeIds);
      for (const task of response.tasks) {
        this.queue.enqueue(task);
      }
      entityCount = response.tasks.length;
    } catch (error) {
      if (error instanceof TransientError) {
        console.error(`[Hermes] Transient poll error: ${error.message}, backing off...`);
      } else {
        console.error(`[Hermes] Poll error: ${(error as Error).message}`);
      }
    }

    // Background-intent cycle — pulls due rows from /background-tasks and
    // materialises each one into a synthetic Task. Failures are
    // non-fatal and don't disturb the entity-task path above.
    let intentCount = 0;
    try {
      const due = await this.intentPoller.pollDueIntents();
      for (const row of due) {
        const task = IntentPoller.toTask(row);
        this.intentSources.set(task.id, row);
        this.queue.enqueue(task);
      }
      intentCount = due.length;
    } catch (err) {
      console.error(
        `[Hermes] Intent poll error: ${(err as Error).message}`,
      );
    }

    // Feature pipeline cycle — watches devplane_feature entities and enqueues
    // pipeline tasks when agent_status transitions to "idle".
    let featureCount = 0;
    if (this.featurePoller) {
      try {
        featureCount = await this.featurePoller.pollOnce();
      } catch (err) {
        console.error(
          `[Hermes] Feature poll error: ${(err as Error).message}`,
        );
      }
    }

    return entityCount + intentCount + featureCount;
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
   *
   * Personality-aware dispatch: if `task.assignedAgentId` matches a known
   * personality, fetch its `agent_configs` row via Hub REST and pass it to
   * the executor so the spawned subprocess uses the right prompt/tools/model.
   */
  private async _processQueue(): Promise<void> {
    while (!this.queue.isEmpty && !this._stopRequested && this.executor.activeCount < this.config.maxConcurrentTasks) {
      const task = this.queue.dequeue();
      if (!task) break;

      this._stats.lastTaskId = task.id;

      const intentSource = this.intentSources.get(task.id);
      const isIntentTask = intentSource !== undefined;
      const isPipelineTask = task.context?.isPipelineTask === true;
      const pipelinePhase = task.context?.phase as import('./feature-poll.js').PipelinePhase | undefined;
      const pipelineFeatureId = task.context?.featureId as string | undefined;

      // Transcription tasks are handled inline — no subprocess.
      if (this._isTranscribeTask(task)) {
        await this._handleTranscribeTask(task);
        continue;
      }

      // Pipeline tasks update the feature's agent_status field instead of a
      // task entity row (which doesn't exist for in-memory pipeline tasks).
      // Regular entity tasks tell Synap we're starting via PATCH.
      if (isPipelineTask && pipelinePhase && pipelineFeatureId) {
        await this.featurePoller?.updateFeatureAgentStatus(
          pipelineFeatureId,
          this.featurePoller.phaseRunningStatus(pipelinePhase),
        );
      } else if (!isIntentTask) {
        await this.poller.updateTaskStatus(task.id, 'in-progress');
      }

      try {
        const personality = await this._resolvePersonalityForTask(task);
        const handle = await this.executor.execute(task, personality);
        const result = await handle.waitForCompletion();
        const succeeded = result.exitCode === 0;

        if (succeeded) {
          this._stats.tasksCompleted++;
        } else {
          this._stats.tasksFailed++;
        }

        if (isIntentTask) {
          await this.intentPoller.recordRunResult({
            intentId: intentSource.id,
            succeeded,
            errorMessage: succeeded
              ? undefined
              : result.stderr.slice(-500) || `exit code ${result.exitCode ?? 'null'}`,
            intent: intentSource,
          });
          this.intentSources.delete(task.id);
        } else if (isPipelineTask && pipelinePhase && pipelineFeatureId) {
          await this.featurePoller?.updateFeatureAgentStatus(
            pipelineFeatureId,
            succeeded
              ? this.featurePoller.phaseSuccessStatus(pipelinePhase)
              : 'blocked',
          );
        } else if (succeeded) {
          await this.poller.submitResult(task.id, {
            output: result.stdout,
            durationMs: result.durationMs,
          });
        } else {
          await this.poller.updateTaskStatus(task.id, 'failed');
        }
      } catch (error) {
        this._stats.tasksFailed++;
        const message = (error as Error).message;
        console.error(`[Hermes] Task ${task.id} failed: ${message}`);
        if (isIntentTask) {
          try {
            await this.intentPoller.recordRunResult({
              intentId: intentSource.id,
              succeeded: false,
              errorMessage: message,
              intent: intentSource,
            });
          } catch (err) {
            console.error(
              `[Hermes] Failed to record intent failure for ${intentSource.id}: ${(err as Error).message}`,
            );
          }
          this.intentSources.delete(task.id);
        } else if (isPipelineTask && pipelineFeatureId) {
          await this.featurePoller?.updateFeatureAgentStatus(pipelineFeatureId, 'blocked');
        } else {
          await this.poller.updateTaskStatus(task.id, 'failed');
        }
      }
    }
  }

  /**
   * If the task is assigned to a known personality, hydrate its `agent_configs`
   * overrides via Hub REST. Returns undefined for the default Hermes path so
   * the executor falls back to engine defaults.
   *
   * Workspace resolution order: task.context.workspaceId → defaultWorkspaceId
   * → unscoped (Hub returns first match across workspaces).
   */
  private async _resolvePersonalityForTask(
    task: Task,
  ): Promise<ResolvedPersonality | undefined> {
    const assigneeId = task.assignedAgentId;
    if (!assigneeId || assigneeId === 'hermes') return undefined;

    // Try userId lookup first; pipeline tasks use agentType slugs as assignedAgentId.
    const record =
      this.personalityById.get(assigneeId) ??
      this.personalityByAgentType.get(assigneeId);
    if (!record) {
      // Unknown assignee — stale cache or first-seen slug. Refresh once and retry both maps.
      this.refreshPersonalities();
      await this.discoverPersonalities();
      const retry =
        this.personalityById.get(assigneeId) ??
        this.personalityByAgentType.get(assigneeId);
      if (!retry) {
        console.warn(
          `[Hermes] Task ${task.id} assigned to unknown personality '${assigneeId}'; ` +
            `running with engine defaults`,
        );
        return undefined;
      }
      return this._hydratePersonality(retry, task);
    }

    return this._hydratePersonality(record, task);
  }

  private async _hydratePersonality(
    record: PersonalityRecord,
    task: Task,
  ): Promise<ResolvedPersonality> {
    const ctx = (task.context ?? {}) as { workspaceId?: string };
    const workspaceId = ctx.workspaceId ?? this.config.defaultWorkspaceId;
    let overrides = null;
    try {
      overrides = await this.poller.getAgentConfig({
        userId: record.userId,
        workspaceId,
        agentType: record.agentType,
      });
    } catch (err) {
      console.warn(
        `[Hermes] getAgentConfig failed for personality '${record.userId}': ` +
          `${(err as Error).message}; running with engine defaults`,
      );
    }
    return {
      userId: record.userId,
      agentType: record.agentType,
      displayName: record.displayName,
      overrides,
    };
  }

  private _isTranscribeTask(task: Task): boolean {
    const ctx = task.context ?? {};
    return (
      (ctx as Record<string, unknown>)['action'] === 'hermes.transcribe' ||
      task.title.startsWith('[voice]') ||
      task.title.startsWith('[transcribe]')
    );
  }

  private async _handleTranscribeTask(task: Task): Promise<void> {
    const ctx = (task.context ?? {}) as Record<string, unknown>;
    const audioUrl = ctx['audioUrl'] as string | undefined;

    if (!audioUrl) {
      console.error(`[Hermes] Transcription task ${task.id} missing context.audioUrl`);
      await this.poller.updateTaskStatus(task.id, 'failed');
      this._stats.tasksFailed++;
      return;
    }

    await this.poller.updateTaskStatus(task.id, 'in-progress');

    try {
      const secrets = await readEveSecrets(this.config.workspaceDir);
      const tConfig = secrets?.arms?.transcription;
      const engine = tConfig?.engine ?? 'whisper-local';
      const transcriber = new VoiceTranscriber();

      const result = await transcriber.transcribe(audioUrl, {
        engine,
        modelSize: tConfig?.modelSize as WhisperModelSize | undefined,
        apiKey: tConfig?.apiKey,
        language: tConfig?.language,
      });

      await this.poller.submitResult(task.id, {
        transcript: result.transcript,
        engine: result.engine,
        durationMs: result.durationMs,
        audioUrl,
      });

      // Best-effort: write transcript as a note to Synap memory
      await this._writeTranscriptToMemory(task, result.transcript, secrets);

      this._stats.tasksCompleted++;
      console.log(`[Hermes] Transcribed voice memo (${result.durationMs}ms, engine=${engine}): ${result.transcript.slice(0, 80)}…`);
    } catch (error) {
      const message = (error as Error).message;
      console.error(`[Hermes] Transcription failed for task ${task.id}: ${message}`);
      this._stats.tasksFailed++;
      await this.poller.submitResult(task.id, {
        error: message,
        pending_transcription: true,
        audioUrl,
      });
      await this.poller.updateTaskStatus(task.id, 'failed');
    }
  }

  private async _writeTranscriptToMemory(
    task: Task,
    transcript: string,
    secrets: Awaited<ReturnType<typeof readEveSecrets>>,
  ): Promise<void> {
    if (!secrets?.agents?.hermes?.hubApiKey || !this.config.apiUrl) return;
    const ctx = (task.context ?? {}) as Record<string, unknown>;
    try {
      await fetch(`${this.config.apiUrl}/api/hub/entities`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secrets.agents.hermes.hubApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          profileSlug: 'note',
          title: `Voice memo — ${new Date().toLocaleDateString()}`,
          content: transcript,
          userId: ctx['userId'],
          metadata: {
            source: 'voice-memo',
            platform: ctx['platform'] ?? 'unknown',
            taskId: task.id,
          },
        }),
      });
    } catch {
      // Non-fatal — memory write failing must not mark the task failed
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
