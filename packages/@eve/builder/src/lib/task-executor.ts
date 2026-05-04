import { spawn, type ChildProcess } from 'node:child_process';
import {
  readCodeEngine,
  readEveSecrets,
  type CodeEngine,
  type Task,
} from '@eve/dna';
import { resolveCoderSpawn, isCoderTask } from './coder-router.js';
import type { AgentConfigOverrides } from './task-poll.js';

export interface TaskExecutionResult {
  taskId: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  pid: number;
  durationMs: number;
}

export interface TaskExecutorConfig {
  /** Max concurrent task executions */
  maxConcurrent: number;
  /** Default timeout per task in ms (default: 30 minutes) */
  timeoutMs?: number;
  /** Workspace directory for task artifacts */
  workspaceDir: string;
  /**
   * Override the engine used for coder-role tasks. When unset we read
   * `secrets.builder.codeEngine` from the workspace's `.eve/secrets.json`
   * once per `execute()` call. Useful for tests + one-off invocations.
   */
  codeEngineOverride?: CodeEngine;
}

/**
 * Resolved personality runtime config — what Hermes hands to TaskExecutor
 * before spawning the subprocess. Sourced from `agent_configs` (Hub REST).
 */
export interface ResolvedPersonality {
  /** The personality user ID (== users.id, userType='agent'). */
  userId: string;
  /** Free-form agent type slug (matches agent_configs.agent_type). */
  agentType: string;
  /** Display name for logs. */
  displayName?: string;
  /** Per-personality overrides. Optional — undefined = engine defaults. */
  overrides?: AgentConfigOverrides | null;
}

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Executes tasks by spawning subprocesses (claude / opencode / openclaude /
 * custom commands). Uses child_process.spawn — never execSync — so the
 * daemon stays responsive.
 *
 * Coder routing: when a task implies the coder role (assignee = "coder",
 * type = "code-gen", or context.role = "coder"), we read
 * `secrets.builder.codeEngine` and pick the matching adapter. The Hub
 * Protocol identity is always the single `coder` agent slug — three
 * spawn implementations, one identity.
 */
export class TaskExecutor {
  private config: TaskExecutorConfig;
  private activeProcesses = new Map<string, ProcessHandle>();

  constructor(config: TaskExecutorConfig) {
    this.config = config;
    this.config.timeoutMs ??= DEFAULT_TIMEOUT_MS;
  }

  /**
   * Execute a task by spawning the appropriate subprocess.
   * Returns immediately with a ProcessHandle — use waitForCompletion() to await.
   *
   * Async because resolving the coder engine reads `secrets.json`. Tests
   * that don't care about the file can pass `codeEngineOverride` in the
   * executor config.
   */
  async execute(task: Task, personality?: ResolvedPersonality): Promise<ProcessHandle> {
    if (this.activeProcesses.size >= this.config.maxConcurrent) {
      throw new Error(
        `Max concurrency reached (${this.config.maxConcurrent}). Queue the task.`,
      );
    }

    const engine = await this.resolveEngine();
    const handle = new ProcessHandle(task.id, task, this.config, engine, personality);
    handle.start();
    this.activeProcesses.set(task.id, handle);
    const cleanup = () => this.activeProcesses.delete(task.id);
    handle.onDone(cleanup);
    return handle;
  }

  /**
   * Execute a task and wait for completion (convenience wrapper).
   * For daemon use, prefer execute() + onDone for non-blocking behavior.
   */
  async executeAndWait(
    task: Task,
    personality?: ResolvedPersonality,
  ): Promise<TaskExecutionResult> {
    const handle = await this.execute(task, personality);
    return handle.waitForCompletion();
  }

  /**
   * Resolve the engine used by coder-role tasks. Override > secrets.json >
   * default. Reads once per `execute()` call so engine swaps via the
   * dashboard take effect on the next task without restarting the daemon.
   */
  private async resolveEngine(): Promise<CodeEngine> {
    if (this.config.codeEngineOverride) return this.config.codeEngineOverride;
    const secrets = await readEveSecrets(this.config.workspaceDir);
    return readCodeEngine(secrets);
  }

  /** Get count of currently active processes. */
  get activeCount(): number {
    return this.activeProcesses.size;
  }

  /** Cancel a running task by task ID. */
  async cancel(taskId: string): Promise<boolean> {
    const handle = this.activeProcesses.get(taskId);
    if (!handle) return false;
    return handle.cancel();
  }
}

/**
 * Handles a single subprocess execution.
 * Wraps child_process.spawn with timeout, stdout/stderr capture, and lifecycle events.
 */
export class ProcessHandle {
  private taskId: string;
  private task: Task;
  private config: TaskExecutorConfig;
  /** Engine resolved at execute() time — frozen for the life of the handle. */
  private engine: CodeEngine;
  /** Personality config — undefined for default Hermes runs. */
  private personality?: ResolvedPersonality;
  private childProc: ChildProcess | null = null;
  private stdout = '';
  private stderr = '';
  private startTime = 0;
  private exitCode: number | null = null;
  private _doneCallback: (() => void) | null = null;
  private resolveWait: (() => void) | null = null;
  private waitPromise: Promise<void> | null = null;

  constructor(
    taskId: string,
    task: Task,
    config: TaskExecutorConfig,
    engine: CodeEngine,
    personality?: ResolvedPersonality,
  ) {
    this.taskId = taskId;
    this.task = task;
    this.config = config;
    this.engine = engine;
    this.personality = personality;
    this.startTime = Date.now();
  }

  /**
   * Register a callback invoked when the process completes.
   */
  onDone(cb: () => void): void {
    this._doneCallback = cb;
  }

  /**
   * Start the subprocess and begin capturing output.
   */
  start(): void {
    const spawnCommand = this.resolveSpawnCommand();
    this.childProc = spawn(spawnCommand.command, spawnCommand.args, {
      cwd: this.config.workspaceDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ...this.buildPersonalityEnv(),
        ...(this.task.context?.env as Record<string, string> | undefined),
      },
    });

    this.childProc.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      this.stdout += text;
      process.stdout.write(text);
    });

    this.childProc.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      this.stderr += text;
      process.stderr.write(text);
    });

    this.childProc.on('close', (code) => {
      this.exitCode = code;
      this._triggerDone();
    });

    this.childProc.on('error', (err) => {
      this.stderr += `Spawn error: ${err.message}\n`;
      this.exitCode = 1;
      this._triggerDone();
    });

    // Timeout handling
    const timeoutMs = this.config.timeoutMs!;
    if (timeoutMs > 0) {
      setTimeout(() => {
        if (this.exitCode === null) {
          this.cancel();
          this.stderr += `[timeout] Task killed after ${timeoutMs}ms\n`;
        }
      }, timeoutMs);
    }
  }

  /** Wait for the subprocess to complete. */
  async waitForCompletion(): Promise<TaskExecutionResult> {
    if (!this.waitPromise) {
      this.waitPromise = new Promise<void>((resolve) => {
        this.resolveWait = resolve;
      });
    }
    await this.waitPromise;

    return {
      taskId: this.taskId,
      exitCode: this.exitCode,
      stdout: this.stdout,
      stderr: this.stderr,
      pid: this.childProc?.pid ?? 0,
      durationMs: Date.now() - this.startTime,
    };
  }

  /** Cancel the running process. */
  async cancel(): Promise<boolean> {
    if (!this.childProc || this.exitCode !== null) return false;
    try {
      this.childProc.kill('SIGTERM');
      // Give it 5 seconds, then SIGKILL
      setTimeout(() => {
        if (this.exitCode === null) {
          this.childProc?.kill('SIGKILL');
        }
      }, 5000);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Resolve which command to spawn based on the task + the configured
   * code engine.
   *
   * Routing rules:
   *   - context.customCommand → spawn it verbatim with the prompt appended.
   *   - coder-role task (assignee=coder, type=code-gen, or context.role=coder)
   *     → resolveCoderSpawn(engine) — picks the right CLI binary for the
   *     selected `secrets.builder.codeEngine`.
   *   - everything else → fall back to the configured engine's CLI. (For
   *     non-coder tasks this is a soft default; the daemon mostly emits
   *     coder tasks, so this branch is rarely hit in practice.)
   *
   * `context.engine` (the legacy per-task override) is ALSO honored when
   * present — keeps Hermes daemon tests / one-off operator invocations
   * working without a secrets.json file.
   */
  private resolveSpawnCommand(): { command: string; args: string[] } {
    const context = this.task.context || {};

    // Build prompt from task title + description
    const taskPrompt = this.task.description
      ? `${this.task.title}\n\n${this.task.description}`
      : this.task.title;

    // 1. Custom command always wins. Personality overrides are surfaced via env
    // vars only for custom commands — translating to flags would be ambiguous.
    const custom = context.customCommand as string | undefined;
    if (typeof custom === 'string' && custom.trim().length > 0) {
      const parts = custom.trim().split(/\s+/);
      return { command: parts[0], args: [...parts.slice(1), taskPrompt] };
    }

    // 2. Per-task engine override (legacy escape hatch).
    const taskEngine = context.engine as string | undefined;
    const effectiveEngine: CodeEngine =
      taskEngine === 'claudecode' || taskEngine === 'opencode' || taskEngine === 'openclaude'
        ? taskEngine
        : this.engine;

    // 3. Translate personality overrides into engine-specific flags. Tool
    // restrictions are NOT translatable to argv on these CLIs — they go
    // through env (see buildPersonalityEnv) for skill-loader-side filtering.
    const overrides = this.personality?.overrides;
    const supportsToolFlags = false; // none of our 3 engines accept --tools today
    if (
      overrides &&
      !supportsToolFlags &&
      ((overrides.extraToolIds?.length ?? 0) > 0 ||
        (overrides.disabledToolIds?.length ?? 0) > 0)
    ) {
      console.warn(
        `[Hermes] engine '${effectiveEngine}' has no tool-restriction CLI flags; ` +
          `extraToolIds/disabledToolIds passed via env only`,
      );
    }

    // 4. Coder-role tasks → engine-specific adapter (with overrides).
    if (isCoderTask(this.task)) {
      return resolveCoderSpawn(effectiveEngine, taskPrompt, {
        model: overrides?.modelOverride ?? undefined,
        promptAppend: overrides?.promptAppend ?? undefined,
      });
    }

    // 5. Non-coder fallback — same engine binaries, same args. The daemon
    // hardly ever routes here, but keep behaviour stable for callers that
    // pass a generic Task with no role hint.
    return resolveCoderSpawn(effectiveEngine, taskPrompt, {
      model: overrides?.modelOverride ?? undefined,
      promptAppend: overrides?.promptAppend ?? undefined,
    });
  }

  /**
   * Build env vars exposing the personality + its overrides to the spawned
   * subprocess. Engine adapters (skill loader, openclaude config, etc.) read
   * these on the OTHER side of the spawn boundary to enforce tool restrictions
   * and step caps. Empty for default Hermes runs.
   */
  private buildPersonalityEnv(): Record<string, string> {
    if (!this.personality) return {};
    const env: Record<string, string> = {
      HERMES_PERSONALITY_USER_ID: this.personality.userId,
      HERMES_PERSONALITY_AGENT_TYPE: this.personality.agentType,
    };
    if (this.personality.displayName) {
      env.HERMES_PERSONALITY_NAME = this.personality.displayName;
    }
    const o = this.personality.overrides;
    if (!o) return env;
    if (o.modelOverride) env.HERMES_MODEL_OVERRIDE = o.modelOverride;
    if (o.promptAppend) env.HERMES_PROMPT_APPEND = o.promptAppend;
    if (o.extraToolIds?.length > 0) {
      env.HERMES_EXTRA_TOOLS = o.extraToolIds.join(',');
    }
    if (o.disabledToolIds?.length > 0) {
      env.HERMES_DISABLED_TOOLS = o.disabledToolIds.join(',');
    }
    if (typeof o.maxStepsOverride === 'number') {
      env.HERMES_MAX_STEPS = String(o.maxStepsOverride);
    }
    return env;
  }

  private _triggerDone(): void {
    this.resolveWait?.();
    this._doneCallback?.();
  }
}
