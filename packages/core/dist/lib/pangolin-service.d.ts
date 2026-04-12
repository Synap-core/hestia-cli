/**
 * PangolinService - Secure Tunnel Management for Hestia
 *
 * Manages Pangolin tunnel integration for secure remote access to Hestia nodes.
 * Pangolin is a self-hosted tunneling solution using WireGuard that works
 * behind CGNAT without relying on third-party services like Cloudflare.
 *
 * Why Pangolin vs Alternatives:
 * - Self-hosted (no Cloudflare dependency)
 * - WireGuard-based (fast, secure, modern crypto)
 * - Works behind CGNAT (no port forwarding needed)
 * - Identity-aware access control
 * - Multiple tunnel endpoints per client
 *
 * Deployment Modes:
 * - Server: Runs on a VPS with public IP, acts as relay/tunnel endpoint
 * - Client: Runs on home server, connects to server, exposes local services
 *
 * Quick Start:
 * 1. On VPS: hestia tunnel:enable --mode server
 * 2. On Home: hestia tunnel:enable --mode client --server <vps-ip>
 * 3. Access home Hestia via https://tunnel.yourdomain.com
 */
export type TunnelMode = 'server' | 'client' | 'none';
export type TunnelProvider = 'pangolin' | 'cloudflare' | 'none';
export type TunnelStatus = 'connected' | 'disconnected' | 'connecting' | 'error' | 'unknown';
export interface TunnelConfig {
    enabled: boolean;
    provider: TunnelProvider;
    mode?: TunnelMode;
    serverUrl?: string;
    token?: string;
    publicUrl?: string;
    wireguard?: {
        privateKey: string;
        publicKey: string;
        serverPublicKey?: string;
        endpoint?: string;
        allowedIPs?: string;
        keepalive?: number;
    };
    tunnels?: Array<{
        name: string;
        localPort: number;
        remotePort?: number;
        protocol: 'tcp' | 'udp' | 'both';
    }>;
}
export interface TunnelInfo {
    status: TunnelStatus;
    mode?: TunnelMode;
    publicUrl?: string;
    serverUrl?: string;
    connectedAt?: Date;
    lastError?: string;
    bytesTransferred: {
        sent: number;
        received: number;
    };
    latency?: number;
    activeTunnels: number;
}
export interface ServerConfig {
    domain: string;
    baseUrl: string;
    serverPort: number;
    wireguardPort: number;
    apiKey: string;
}
export interface ClientConfig {
    serverUrl: string;
    clientName: string;
    token: string;
    serverPublicKey: string;
    endpoint: string;
}
export interface PangolinStatus {
    installed: boolean;
    running: boolean;
    mode?: TunnelMode;
    version?: string;
    configValid: boolean;
    errors: string[];
}
export declare class PangolinService {
    private readonly composeFile;
    private readonly configDir;
    private readonly dataDir;
    private wgKeys;
    constructor();
    /**
     * Install Pangolin - prepares the Docker Compose file and directories
     * @param mode - Whether to install as 'server' or 'client'
     */
    install(mode: TunnelMode): boolean;
    /**
     * Uninstall Pangolin - removes containers and configuration
     */
    uninstall(): boolean;
    /**
     * Configure as Pangolin Server (runs on VPS with public IP)
     * @param config - Server configuration options
     */
    configureServer(config: Partial<ServerConfig>): boolean;
    /**
     * Configure as Pangolin Client (runs on home server behind CGNAT)
     * @param serverUrl - URL of the Pangolin server
     * @param token - Authentication token from server
     */
    configureClient(serverUrl: string, token: string): boolean;
    /**
     * Update tunnel configuration
     */
    updateConfig(updates: Partial<TunnelConfig>): boolean;
    /**
     * Start Pangolin services
     */
    start(): boolean;
    /**
     * Stop Pangolin services
     */
    stop(): boolean;
    /**
     * Restart Pangolin services
     */
    restart(): boolean;
    /**
     * Get current tunnel status
     */
    getStatus(): Promise<TunnelInfo>;
    /**
     * Get public tunnel URL
     */
    getTunnelUrl(): Promise<string | undefined>;
    /**
     * List active tunnels
     */
    listTunnels(): Promise<Array<{
        name: string;
        localPort: number;
        remotePort?: number;
        status: 'active' | 'inactive';
        url?: string;
    }>>;
    /**
     * Get comprehensive Pangolin status
     */
    getPangolinStatus(): Promise<PangolinStatus>;
    /**
     * Get tunnel logs
     * @param lines - Number of lines to return
     */
    getLogs(lines?: number): Promise<string>;
    /**
     * Follow tunnel logs (for CLI streaming)
     */
    followLogs(): Promise<void>;
    private ensureDirectories;
    private createComposeFile;
    private getEmbeddedComposeTemplate;
    private generateWireGuardKeys;
    private generateSecureToken;
    private getSystemDomain;
    private getHearthName;
    private fetchServerConfig;
    private buildTunnelsConfig;
    private getDefaultTunnels;
    private serializeTunnels;
    private updateEnvFile;
    private loadTunnelConfig;
    private saveTunnelConfig;
    private isContainerRunning;
    private getContainerStatus;
}
export declare const pangolinService: PangolinService;
//# sourceMappingURL=pangolin-service.d.ts.map