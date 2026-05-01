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
    configureSubdomains(domain: string, ssl: boolean, email?: string, installedComponents?: string[]): Promise<void>;
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
    private readonly cwd;
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

type LegsProxySetupOptions = {
    domain?: string;
    tunnel?: 'pangolin' | 'cloudflare' | 'pangolin_tunnel' | 'cloudflare_tunnel';
    tunnelDomain?: string;
    ssl?: boolean;
    /** Use /opt/eve/traefik instead of Dokploy-managed Traefik */
    standalone?: boolean;
};
/**
 * Programmatic entry for `eve legs setup` — Traefik routes + optional Pangolin/Cloudflare tunnel.
 */
declare function runLegsProxySetup(options: LegsProxySetupOptions): Promise<void>;

/**
 * Refresh Traefik routes to match the current installed-components list.
 *
 * Called from `eve add` / `eve remove` so installing a new component
 * automatically wires up its subdomain (and removing one tears it down).
 *
 * No-op if no domain has been configured yet — the user hasn't asked for
 * external routing, so we leave Traefik alone.
 */
interface RefreshResult {
    refreshed: boolean;
    domain: string | null;
    reason?: string;
}
declare function refreshTraefikRoutes(cwd?: string): Promise<RefreshResult>;

/**
 * Post-install verification for components.
 *
 * Confirms a freshly installed component is actually serving — container
 * running, port reachable. Surfaces silent install failures (the `docker run`
 * returned 0 but the container crash-looped) so we don't mark state as `ready`
 * when the service is in fact broken.
 */
interface VerifyResult {
    ok: boolean;
    /** What was checked. */
    checks: Array<{
        name: string;
        ok: boolean;
        detail?: string;
    }>;
    /** One-line summary suitable for spinner.succeed/fail. */
    summary: string;
}
/**
 * Run all checks for a component. For services that aren't HTTP-ish (no
 * service field), only state is checked. Retries reachability for ~10 seconds
 * to account for slow container start.
 */
declare function verifyComponent(componentId: string): Promise<VerifyResult>;

declare function setupCommand(program: Command): void;

/** Register `eve legs domain <subcommand>` (set | status | unset) */
declare function domainCommand(program: Command): void;

declare function newtCommand(program: Command): void;

declare function restartCommand(program: Command): void;

declare function statusCommand(program: Command): void;

/** Register Legs leaf commands on an existing `eve legs` Commander node */
declare function registerLegsCommands(legs: Command): void;
/** @deprecated Use registerLegsCommands on the `legs` subcommand */
declare function registerCommands(program: Command): void;
declare const _default: {
    registerLegsCommands: typeof registerLegsCommands;
    registerCommands: typeof registerCommands;
};

export { InferenceGateway, type InferenceGatewayResult, type LegsProxySetupOptions, type RefreshResult, type Route, TraefikService, type TunnelConfig, TunnelService, type VerifyResult, _default as default, domainCommand, newtCommand, refreshTraefikRoutes, registerCommands, registerLegsCommands, restartCommand, runLegsProxySetup, setupCommand, statusCommand, verifyComponent };
