import { Command } from 'commander';

interface SynapHealth {
    status: 'healthy' | 'unhealthy' | 'starting';
    version?: string;
    uptime?: number;
}
declare class SynapService {
    private delegate;
    private requireDelegate;
    install(): Promise<void>;
    start(): Promise<void>;
    stop(): Promise<void>;
    isHealthy(): Promise<boolean>;
    getVersion(): Promise<string>;
}

interface SynapDelegatePaths {
    repoRoot: string;
    synapScript: string;
    deployDir: string;
}
/**
 * Resolves the synap-backend checkout path in this order:
 * 1. SYNAP_CLI env override
 * 2. SYNAP_REPO_ROOT env var
 * 3. Saved path in .eve/state.json (written by `eve brain init`)
 * 4. Well-known installation paths (/opt/synap, /opt/synap-backend, …)
 * 5. null — caller must prompt for the path
 */
declare function resolveSynapDelegate(cwd?: string): SynapDelegatePaths | null;

interface ExecResult {
    stdout: string;
    stderr: string;
}
declare function execa(command: string, args: string[], options?: {
    stdio?: 'inherit' | 'pipe';
    cwd?: string;
    env?: NodeJS.ProcessEnv;
}): Promise<ExecResult>;
/** Ensure the 'eve-network' Docker network exists. */
declare function ensureNetwork(): Promise<void>;

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

interface BrainInitOptions {
    withAi?: boolean;
    model?: string;
    /** Path to Synap backend repo checkout; uses official `synap` CLI (full Data Pod) instead of Eve Docker brain. */
    synapRepo?: string;
    /** DOMAIN for `synap install` (default localhost). */
    domain?: string;
    /** Required when domain is not localhost (Let's Encrypt / ops). */
    email?: string;
    withOpenclaw?: boolean;
    withRsshub?: boolean;
    fromImage?: boolean;
    fromSource?: boolean;
    adminEmail?: string;
    adminPassword?: string;
    adminBootstrapMode?: 'preseed' | 'token';
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

declare function startCommand(program: Command): void;

declare function stopCommand(program: Command): void;

/** Register leaf commands on an existing `eve brain` Commander node */
declare function registerBrainCommands(brain: Command): void;

export { type AIModelStatus, type BrainInitOptions, type InferenceInitOptions, OllamaService, type SynapDelegatePaths, type SynapHealth, SynapService, ensureNetwork, execa, initCommand, registerBrainCommands, resolveSynapDelegate, runBrainInit, runInferenceInit, startCommand, statusCommand, stopCommand };
