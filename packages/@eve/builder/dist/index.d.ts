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
    model: string;
    temperature: number;
    maxTokens: number;
    enabled: boolean;
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

declare function initCommand(program: Command): void;

declare function deployCommand(program: Command): void;

declare class Builder {
    opencode: OpenCodeService;
    openclaude: OpenClaudeService;
    dokploy: DokployService;
    constructor();
    init(name: string, template?: string, brainUrl?: string): Promise<void>;
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

export { Builder, type DokployProject, DokployService, type DokployStatus, OpenClaudeService, OpenCodeService, Builder as default, deployCommand, initCommand, registerBuilderCommands };
