import { Command } from 'commander';
import { Task } from '@eve/dna';

declare class OpenCodeService {
    private isInstalled;
    private projectPath;
    install(): Promise<void>;
    initProject(name: string, template?: string): Promise<void>;
    generate(): Promise<void>;
    build(): Promise<void>;
    getProjectPath(): string | null;
}

/**
 * @deprecated OpenClaudeService is deprecated in favor of Hermes daemon polling.
 * This class is kept for backward compatibility during the migration window.
 * New code should use HermesDaemon + TaskExecutor for headless task execution.
 */
declare class OpenClaudeService {
    private isInstalled;
    private _configured;
    private configPath;
    /**
     * @deprecated Hermes daemon handles task execution now.
     * This method only prints a deprecation warning.
     */
    install(): Promise<void>;
    /**
     * @deprecated Hermes reads its config from .eve/hermes-state.json.
     * This method only saves a deprecation notice.
     */
    configure(brainUrl: string): Promise<void>;
    /**
     * @deprecated Hermes daemon handles lifecycle now.
     */
    start(): Promise<void>;
    /**
     * @deprecated No-op. Use Hermes daemon + TaskExecutor.
     */
    generateCode(prompt: string): Promise<string>;
    getConfig(): {
        brainUrl?: string;
        deprecated?: boolean;
    };
    isConfigured(): boolean;
}

interface DokployStatus {
    installed: boolean;
    running: boolean;
    version: string | null;
    projects: DokployProject[];
}
interface DokployProject {
    id: string;
    name: string;
    status: 'running' | 'stopped' | 'error' | 'deploying';
    url?: string;
    lastDeployed?: Date;
}
declare class DokployService {
    private isInstalled;
    private apiUrl;
    private apiKey;
    private projects;
    install(): Promise<void>;
    private loadConfig;
    private saveConfig;
    createProject(name: string): Promise<void>;
    deploy(projectId: string): Promise<void>;
    getStatus(): Promise<DokployStatus>;
    configureDomain(domain: string): Promise<void>;
    getProject(projectId: string): DokployProject | undefined;
    listProjects(): DokployProject[];
}

/**
 * Anthropic Claude Code CLI — native install preferred; npm fallback.
 * Skills: https://code.claude.com/docs/en/skills (project `.claude/skills/`).
 */
declare class ClaudeCodeService {
    private installed;
    install(): Promise<void>;
    /**
     * Writes `.claude/settings.json` (env for Hub) + copies synap skill into `.claude/skills/synap/`.
     * See: https://code.claude.com/docs/en/settings
     */
    configureProject(projectDir: string, cwd?: string): Promise<void>;
}

/** Workspace project directory (same layout as OpenCodeService.initProject). */
declare function resolveBuilderProjectDir(name: string, cwd?: string): Promise<string>;
/** Minimal tree when OpenCode is not selected. */
declare function scaffoldNonOpencodeProject(name: string, cwd?: string): Promise<string>;

type BuilderEngine = 'opencode' | 'openclaude' | 'claudecode';
type RunBuilderOrganOptions = {
    name: string;
    cwd?: string;
    engines: Set<BuilderEngine>;
    template?: string;
    brainUrl?: string;
    /** Dokploy is optional — many pods use static deploy or webhooks only */
    withDokploy?: boolean;
};
type RunBuilderOrganResult = {
    projectDir: string;
    engines: BuilderEngine[];
    dokployUsed: boolean;
};
declare function runBuilderOrganSetup(opts: RunBuilderOrganOptions): Promise<RunBuilderOrganResult>;

type HermesStatus = 'idle' | 'polling' | 'running' | 'error' | 'stopping';
interface HermesConfig {
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
interface HermesStats {
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
declare class HermesDaemon {
    private config;
    private poller;
    private executor;
    private queue;
    private _status;
    private _stats;
    private _stopRequested;
    private pollTimer;
    private workingTimer;
    constructor(config?: Partial<HermesConfig>);
    get status(): HermesStatus;
    get isRunning(): boolean;
    get stats(): HermesStats;
    get queueSize(): number;
    /**
     * Start the daemon loop.
     * Begins polling and processing tasks in the background.
     * Registers SIGINT/SIGTERM handlers for graceful shutdown.
     */
    start(): Promise<void>;
    /**
     * Stop the daemon gracefully.
     * Finishes any currently running task, then exits the poll loop.
     */
    stop(): Promise<void>;
    /**
     * Restart the daemon (stop + start).
     */
    restart(): Promise<void>;
    /**
     * Trigger a single poll (for debugging/one-shot use).
     */
    pollOnce(): Promise<number>;
    /**
     * Main daemon loop.
     * Polls → enqueues tasks → processes queue → waits → repeats.
     */
    private _runLoop;
    /**
     * Process all queued tasks sequentially (respecting maxConcurrent).
     */
    private _processQueue;
    private _sleep;
}

interface PollConfig {
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
interface TaskSyncResponse {
    tasks: Task[];
    since: string;
}
/**
 * Poller for tasks from Synap's entity router.
 * Queries entities with filter: type=task, assignedAgentId=hermes (or assigned=agent).
 */
declare class TaskPoller {
    private config;
    private lastSince;
    private retryCount;
    private currentBackoff;
    private _running;
    constructor(config: PollConfig);
    get running(): boolean;
    /**
     * Poll Synap for new/updated tasks.
     * Uses the entity router with filters: profileSlug=task, assignedAgentId=hermes.
     */
    pollTasks(): Promise<TaskSyncResponse>;
    /** Submit task result back to Synap. */
    submitResult(taskId: string, result: Record<string, unknown>): Promise<boolean>;
    /** Update task status on Synap. */
    updateTaskStatus(taskId: string, status: Task['status']): Promise<boolean>;
    /** Wait for backoff period (used by daemon loop). */
    getBackoffMs(): number;
    resetCursor(): void;
}

interface TaskExecutionResult {
    taskId: string;
    exitCode: number | null;
    stdout: string;
    stderr: string;
    pid: number;
    durationMs: number;
}
interface TaskExecutorConfig {
    /** Max concurrent task executions */
    maxConcurrent: number;
    /** Default timeout per task in ms (default: 30 minutes) */
    timeoutMs?: number;
    /** Workspace directory for task artifacts */
    workspaceDir: string;
}
/**
 * Executes tasks by spawning subprocesses (opencode, claude, custom commands).
 * Uses child_process.spawn — never execSync — so the daemon stays responsive.
 */
declare class TaskExecutor {
    private config;
    private activeProcesses;
    constructor(config: TaskExecutorConfig);
    /**
     * Execute a task by spawning the appropriate subprocess.
     * Returns immediately with a ProcessHandle — use waitForCompletion() to await.
     */
    execute(task: Task): ProcessHandle;
    /**
     * Execute a task and wait for completion (convenience wrapper).
     * For daemon use, prefer execute() + onDone for non-blocking behavior.
     */
    executeAndWait(task: Task): Promise<TaskExecutionResult>;
    /** Get count of currently active processes. */
    get activeCount(): number;
    /** Cancel a running task by task ID. */
    cancel(taskId: string): Promise<boolean>;
}
/**
 * Handles a single subprocess execution.
 * Wraps child_process.spawn with timeout, stdout/stderr capture, and lifecycle events.
 */
declare class ProcessHandle {
    private taskId;
    private task;
    private config;
    private childProc;
    private stdout;
    private stderr;
    private startTime;
    private exitCode;
    private _doneCallback;
    private resolveWait;
    private waitPromise;
    constructor(taskId: string, task: Task, config: TaskExecutorConfig);
    /**
     * Register a callback invoked when the process completes.
     */
    onDone(cb: () => void): void;
    /**
     * Start the subprocess and begin capturing output.
     */
    start(): void;
    /** Wait for the subprocess to complete. */
    waitForCompletion(): Promise<TaskExecutionResult>;
    /** Cancel the running process. */
    cancel(): Promise<boolean>;
    /** Resolve which command to spawn based on task context. */
    private resolveSpawnCommand;
    private _triggerDone;
}

/** In-memory FIFO task queue with priority support. */
declare class TaskQueue {
    private queue;
    private maxSize;
    constructor(maxSize?: number);
    /** Add a task to the queue. Returns false if queue is full. */
    enqueue(task: Task): boolean;
    /** Remove and return the highest-priority task. */
    dequeue(): Task | undefined;
    /** Peek at the next task without removing it. */
    peek(): Task | undefined;
    /** Number of tasks in the queue. */
    get size(): number;
    /** Whether the queue is empty. */
    get isEmpty(): boolean;
    /** Whether the queue is full. */
    get isFull(): boolean;
    /** Clear all tasks from the queue. */
    clear(): void;
    /** Return a copy of all tasks ordered by priority. */
    toArray(): Task[];
}

/**
 * Hermes CLI commands — start, stop, status, poll, logs.
 */
declare function registerHermesCommands(yargs: any): any;

declare function initCommand(program: Command): void;

declare function deployCommand(program: Command): void;

declare class Builder {
    opencode: OpenCodeService;
    openclaude: OpenClaudeService;
    dokploy: DokployService;
    claudecode: ClaudeCodeService;
    constructor();
    /**
     * Legacy programmatic init — same as `eve builder init` (Builder organ first).
     * @param withDokploy default false (Dokploy is optional / often overkill).
     */
    init(name: string, template?: string, brainUrl?: string, withDokploy?: boolean): Promise<void>;
    generate(): Promise<void>;
    build(): Promise<void>;
    generateCode(prompt: string): Promise<string>;
    deploy(projectId?: string): Promise<void>;
    getStatus(): Promise<{
        opencode: string | null;
        openclaude: {
            configured: boolean;
            brainUrl: string | null;
        };
        dokploy: DokployStatus;
    }>;
}
/** Register Builder leaf commands on an existing `eve builder` Commander node */
declare function registerBuilderCommands(builder: Command): void;

export { Builder, type BuilderEngine, ClaudeCodeService, type DokployProject, DokployService, type DokployStatus, HermesDaemon, OpenClaudeService, OpenCodeService, type RunBuilderOrganOptions, type RunBuilderOrganResult, TaskExecutor, TaskPoller, TaskQueue, Builder as default, deployCommand, initCommand, registerBuilderCommands, registerHermesCommands, resolveBuilderProjectDir, runBuilderOrganSetup, scaffoldNonOpencodeProject };
