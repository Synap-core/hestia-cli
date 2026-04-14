import { Command } from 'commander';

interface Route {
    path: string;
    target: string;
    domain?: string;
    ssl?: boolean;
}
declare class TraefikService {
    private configDir;
    private traefikConfigPath;
    private dynamicConfigDir;
    constructor(configDir?: string);
    install(): Promise<void>;
    private installStandalone;
    private configureDokployTraefik;
    addRoute(route: Route): Promise<void>;
    removeRoute(path: string): Promise<void>;
    configureDomain(domain: string): Promise<void>;
    enableSSL(): Promise<void>;
    getRoutes(): Route[];
    getStatus(): {
        installed: boolean;
        running: boolean;
        domain: string | null;
        ssl: boolean;
        routes: Route[];
    };
}

interface InferenceGatewayResult {
    baseDir: string;
    hostPort: string;
    publicUrl: string;
    username: string;
    password: string;
    secretsFile: string;
}
/**
 * Traefik file-provider gateway in front of Ollama on eve-network (Basic auth).
 * Binds host port 11435 by default so Synap Caddy can keep 80/443.
 */
declare class InferenceGateway {
    private readonly baseDir;
    private readonly hostPort;
    constructor(cwd?: string, hostPort?: string);
    /** APR1 hash line for Traefik usersFile (user:hash). */
    private htpasswdLine;
    ensure(ollamaHost?: string): Promise<InferenceGatewayResult>;
    private gatewayContainerExists;
    private isGatewayRunning;
}

interface TunnelConfig {
    provider: 'pangolin' | 'cloudflare';
    domain: string;
    apiKey?: string;
    tunnelId?: string;
}
declare class TunnelService {
    private configDir;
    constructor(configDir?: string);
    setupPangolin(config?: {
        domain?: string;
        server?: string;
    }): Promise<void>;
    setupCloudflare(config?: {
        domain?: string;
        apiToken?: string;
    }): Promise<void>;
    startTunnel(provider: 'pangolin' | 'cloudflare'): void;
    stopTunnel(provider: 'pangolin' | 'cloudflare'): void;
    getConfig(): TunnelConfig | null;
}

declare function setupCommand(program: Command): void;

/** Register `eve legs domain <subcommand>` (set | status | unset) */
declare function domainCommand(program: Command): void;

/** Register Legs leaf commands on an existing `eve legs` Commander node */
declare function registerLegsCommands(legs: Command): void;
/** @deprecated Use registerLegsCommands on the `legs` subcommand */
declare function registerCommands(program: Command): void;
declare const _default: {
    registerLegsCommands: typeof registerLegsCommands;
    registerCommands: typeof registerCommands;
};

export { InferenceGateway, type InferenceGatewayResult, type Route, TraefikService, type TunnelConfig, TunnelService, _default as default, domainCommand, registerCommands, registerLegsCommands, setupCommand };
