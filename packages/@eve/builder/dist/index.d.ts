import { Command } from 'commander';

declare class OpenCodeService {
    private isInstalled;
    private projectPath;
    install(): Promise<void>;
    initProject(name: string, template?: string): Promise<void>;
    generate(): Promise<void>;
    build(): Promise<void>;
    getProjectPath(): string | null;
}

interface OpenClaudeConfig {
    brainUrl: string;
    basicAuth?: string;
    model: string;
    temperature: number;
    maxTokens: number;
    enabled: boolean;
    synapApiUrl?: string;
    synapApiKey?: string;
    hubBaseUrl?: string;
    skillsDir?: string;
}
declare class OpenClaudeService {
    private isInstalled;
    private config;
    private configPath;
    install(): Promise<void>;
    configure(brainUrl: string): Promise<void>;
    start(): Promise<void>;
    generateCode(prompt: string): Promise<string>;
    getConfig(): OpenClaudeConfig | null;
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

export { Builder, type BuilderEngine, ClaudeCodeService, type DokployProject, DokployService, type DokployStatus, OpenClaudeService, OpenCodeService, type RunBuilderOrganOptions, type RunBuilderOrganResult, Builder as default, deployCommand, initCommand, registerBuilderCommands, resolveBuilderProjectDir, runBuilderOrganSetup, scaffoldNonOpencodeProject };
