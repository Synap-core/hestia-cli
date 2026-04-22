import { spawn, type ChildProcess } from 'node:child_process';
import type { Task } from '@eve/dna';

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
}

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Executes tasks by spawning subprocesses (opencode, claude, custom commands).
 * Uses child_process.spawn — never execSync — so the daemon stays responsive.
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
   */
  execute(task: Task): ProcessHandle {
    if (this.activeProcesses.size >= this.config.maxConcurrent) {
      throw new Error(
        `Max concurrency reached (${this.config.maxConcurrent}). Queue the task.`,
      );
    }

    const handle = new ProcessHandle(task.id, task, this.config);
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
  async executeAndWait(task: Task): Promise<TaskExecutionResult> {
    const handle = this.execute(task);
    return handle.waitForCompletion();
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
  private childProc: ChildProcess | null = null;
  private stdout = '';
  private stderr = '';
  private startTime = 0;
  private exitCode: number | null = null;
  private _doneCallback: (() => void) | null = null;
  private resolveWait: (() => void) | null = null;
  private waitPromise: Promise<void> | null = null;

  constructor(taskId: string, task: Task, config: TaskExecutorConfig) {
    this.taskId = taskId;
    this.task = task;
    this.config = config;
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

  /** Resolve which command to spawn based on task context. */
  private resolveSpawnCommand(): { command: string; args: string[] } {
    const context = this.task.context || {};
    const engine = (context.engine as string) || 'opencode';

    // Build prompt from task title + description
    const taskPrompt = this.task.description
      ? `${this.task.title}\n\n${this.task.description}`
      : this.task.title;

    switch (engine) {
      case 'opencode':
        return {
          command: 'opencode',
          args: ['generate', taskPrompt],
        };

      case 'claudecode':
        return {
          command: 'claude',
          args: ['-p', taskPrompt],
        };

      case 'custom': {
        const cmd = context.customCommand as string | undefined;
        if (cmd) {
          const parts = cmd.split(/\s+/);
          return { command: parts[0], args: [...parts.slice(1), taskPrompt] };
        }
        // Fall back to opencode
        return {
          command: 'opencode',
          args: ['generate', taskPrompt],
        };
      }

      default:
        return {
          command: 'opencode',
          args: ['generate', taskPrompt],
        };
    }
  }

  private _triggerDone(): void {
    this.resolveWait?.();
    this._doneCallback?.();
  }
}
