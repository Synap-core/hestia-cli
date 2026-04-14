import { Command } from 'commander';

interface SynapHealth {
    status: 'healthy' | 'unhealthy' | 'starting';
    version?: string;
    uptime?: number;
}
declare class SynapService {
    private containerName;
    private image;
    private delegate;
    install(): Promise<void>;
    start(): Promise<void>;
    stop(): Promise<void>;
    isHealthy(): Promise<boolean>;
    getVersion(): Promise<string>;
    private isRunning;
    private containerExists;
}

interface SynapDelegatePaths {
    repoRoot: string;
    synapScript: string;
    deployDir: string;
}
/**
 * When SYNAP_REPO_ROOT points at a synap-backend checkout (with deploy/ + synap script),
 * Eve delegates install/ops to the official bash CLI instead of Eve-managed Docker brain.
 */
declare function resolveSynapDelegate(): SynapDelegatePaths | null;

interface ExecResult {
    stdout: string;
    stderr: string;
}
declare function execa(command: string, args: string[], options?: {
    stdio?: 'inherit' | 'pipe';
    cwd?: string;
    env?: NodeJS.ProcessEnv;
}): Promise<ExecResult>;

interface AIModelStatus {
    running: boolean;
    currentModel?: string;
    modelsInstalled: string[];
    memoryUsage?: {
        used: number;
        total: number;
    };
}
declare class OllamaService {
    private containerName;
    private image;
    install(): Promise<void>;
    /**
     * @param publishToHost - When false, Ollama is only on `eve-network` (use with Traefik gateway on Full stack).
     */
    start(options?: {
        publishToHost?: boolean;
    }): Promise<void>;
    pullModel(model: string, startOpts?: {
        publishToHost?: boolean;
    }): Promise<void>;
    isRunning(): Promise<boolean>;
    getStatus(): Promise<AIModelStatus>;
    listModels(): Promise<string[]>;
    private containerExists;
}

declare class PostgresService {
    private containerName;
    private image;
    install(): Promise<void>;
    start(): Promise<void>;
    stop(): Promise<void>;
    createDatabase(name: string): Promise<void>;
    isHealthy(): Promise<boolean>;
    private isRunning;
    private containerExists;
    private waitForReady;
}

declare class RedisService {
    private containerName;
    private image;
    install(): Promise<void>;
    start(): Promise<void>;
    stop(): Promise<void>;
    isHealthy(): Promise<boolean>;
    private isRunning;
    private containerExists;
    private waitForReady;
}

interface BrainInitOptions {
    withAi?: boolean;
    model?: string;
    /** Path to synap-backend repo; uses official `synap` CLI (full Data Pod) instead of Eve Docker brain. */
    synapRepo?: string;
    /** DOMAIN for `synap install` (default localhost). */
    domain?: string;
    /** Required when domain is not localhost (Let's Encrypt / ops). */
    email?: string;
    withOpenclaw?: boolean;
    withRsshub?: boolean;
    fromImage?: boolean;
    fromSource?: boolean;
}
declare function runBrainInit(options: BrainInitOptions): Promise<void>;
declare function initCommand(program: Command): void;

interface InferenceInitOptions {
    model?: string;
    /** When true (default), start Traefik gateway on port 11435 with Basic auth. */
    withGateway?: boolean;
    /** When true with gateway, do not publish Ollama on host (Full stack / Synap coexists). */
    internalOllamaOnly?: boolean;
}
/**
 * Inference-only profile: Ollama on Docker + optional Traefik gateway (Basic auth, default :11435).
 */
declare function runInferenceInit(options?: InferenceInitOptions): Promise<void>;

declare function statusCommand(program: Command): void;

/** Register leaf commands on an existing `eve brain` Commander node */
declare function registerBrainCommands(brain: Command): void;

export { type AIModelStatus, type BrainInitOptions, type InferenceInitOptions, OllamaService, PostgresService, RedisService, type SynapDelegatePaths, type SynapHealth, SynapService, execa, initCommand, registerBrainCommands, resolveSynapDelegate, runBrainInit, runInferenceInit, statusCommand };
