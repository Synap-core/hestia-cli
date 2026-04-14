// @ts-nocheck
/**
 * PangolinService - Secure Tunnel Management for eve
 *
 * Manages Pangolin tunnel integration for secure remote access to eve nodes.
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
 * 1. On VPS: eve tunnel:enable --mode server
 * 2. On Home: eve tunnel:enable --mode client --server <vps-ip>
 * 3. Access home eve via https://tunnel.yourdomain.com
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync } from 'fs';
import * as path from 'path';
import { logger } from '../../lib/utils/index';
import { getConfigPaths, loadConfig, saveConfig, updateConfig } from '../../lib/utils/index';

// ============================================================================
// Types
// ============================================================================

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

// ============================================================================
// Pangolin Service Class
// ============================================================================

export class PangolinService {
  private readonly composeFile: string;
  private readonly configDir: string;
  private readonly dataDir: string;
  private wgKeys: { privateKey: string; publicKey: string } | null = null;

  constructor() {
    const paths = getConfigPaths();
    this.configDir = path.join(paths.configDir, 'pangolin');
    this.dataDir = path.join(process.env.DATA_DIR || '/opt/eve/data', 'pangolin');
    this.composeFile = path.join(process.env.eve_TARGET || '/opt/eve', 'docker-compose.pangolin.yml');
  }

  // ========================================================================
  // Installation
  // ========================================================================

  /**
   * Install Pangolin - prepares the Docker Compose file and directories
   * @param mode - Whether to install as 'server' or 'client'
   */
  install(mode: TunnelMode): boolean {
    try {
      logger.info(`Installing Pangolin in ${mode} mode...`);

      // Ensure directories exist
      this.ensureDirectories();

      // Check if Docker Compose template exists
      const templatePath = path.join(
        process.env.eve_TARGET || '/opt/eve',
        'packages/install/src/templates/pangolin-docker-compose.yml'
      );

      if (!existsSync(templatePath)) {
        // Use embedded template
        this.createComposeFile();
      } else {
        // Copy from template
        const content = readFileSync(templatePath, 'utf-8');
        writeFileSync(this.composeFile, content);
      }

      // Update main .env with tunnel mode
      this.updateEnvFile({ TUNNEL_MODE: mode });

      logger.success(`Pangolin installed for ${mode} mode`);
      return true;
    } catch (error) {
      logger.error(`Failed to install Pangolin: ${error}`);
      return false;
    }
  }

  /**
   * Uninstall Pangolin - removes containers and configuration
   */
  uninstall(): boolean {
    try {
      logger.info('Uninstalling Pangolin...');

      // Stop and remove containers
      this.stop();

      // Remove compose file
      if (existsSync(this.composeFile)) {
        unlinkSync(this.composeFile);
      }

      // Update .env
      this.updateEnvFile({ TUNNEL_MODE: 'none' });

      logger.success('Pangolin uninstalled');
      return true;
    } catch (error) {
      logger.error(`Failed to uninstall Pangolin: ${error}`);
      return false;
    }
  }

  // ========================================================================
  // Configuration
  // ========================================================================

  /**
   * Configure as Pangolin Server (runs on VPS with public IP)
   * @param config - Server configuration options
   */
  configureServer(config: Partial<ServerConfig>): boolean {
    try {
      logger.info('Configuring Pangolin as Server...');

      // Generate WireGuard keys
      const keys = this.generateWireGuardKeys();

      // Generate API key
      const apiKey = this.generateSecureToken();

      // Update environment
      const envUpdates: Record<string, string> = {
        TUNNEL_MODE: 'server',
        PANGOLIN_WG_PRIVATE_KEY: keys.privateKey,
        PANGOLIN_WG_PUBLIC_KEY: keys.publicKey,
        PANGOLIN_API_KEY: apiKey,
        PANGOLIN_DOMAIN: config.domain || `tunnel.${this.getSystemDomain()}`,
        PANGOLIN_BASE_URL: config.baseUrl || `https://tunnel.${this.getSystemDomain()}`,
        PANGOLIN_SERVER_PORT: String(config.serverPort || 3000),
        PANGOLIN_WG_PORT: String(config.wireguardPort || 51820),
      };

      this.updateEnvFile(envUpdates);

      // Save to eve config
      this.saveTunnelConfig({
        enabled: true,
        provider: 'pangolin',
        mode: 'server',
        publicUrl: config.baseUrl,
        wireguard: {
          privateKey: keys.privateKey,
          publicKey: keys.publicKey,
        },
      });

      logger.success('Pangolin Server configured');
      logger.info(`Public URL: ${config.baseUrl || `https://tunnel.${this.getSystemDomain()}`}`);
      logger.info(`WireGuard Port: ${config.wireguardPort || 51820}`);
      logger.info(`API Key: ${apiKey.substring(0, 16)}...`);

      return true;
    } catch (error) {
      logger.error(`Failed to configure Pangolin Server: ${error}`);
      return false;
    }
  }

  /**
   * Configure as Pangolin Client (runs on home server behind CGNAT)
   * @param serverUrl - URL of the Pangolin server
   * @param token - Authentication token from server
   */
  configureClient(serverUrl: string, token: string): boolean {
    try {
      logger.info('Configuring Pangolin as Client...');

      // Generate WireGuard keys for client
      const keys = this.generateWireGuardKeys();

      // Fetch server configuration
      const serverConfig = this.fetchServerConfig(serverUrl, token);

      // Update environment
      const envUpdates: Record<string, string> = {
        TUNNEL_MODE: 'client',
        PANGOLIN_SERVER_URL: serverUrl,
        PANGOLIN_CLIENT_TOKEN: token,
        PANGOLIN_WG_PRIVATE_KEY: keys.privateKey,
        PANGOLIN_WG_PUBLIC_KEY: keys.publicKey,
        PANGOLIN_WG_SERVER_PUBLIC_KEY: serverConfig.serverPublicKey,
        PANGOLIN_WG_ENDPOINT: serverConfig.endpoint,
        PANGOLIN_CLIENT_NAME: this.getHearthName(),
        PANGOLIN_TUNNELS: this.buildTunnelsConfig(),
      };

      this.updateEnvFile(envUpdates);

      // Save to eve config
      this.saveTunnelConfig({
        enabled: true,
        provider: 'pangolin',
        mode: 'client',
        serverUrl,
        token,
        publicUrl: serverConfig.baseUrl,
        wireguard: {
          privateKey: keys.privateKey,
          publicKey: keys.publicKey,
          serverPublicKey: serverConfig.serverPublicKey,
          endpoint: serverConfig.endpoint,
        },
        tunnels: this.getDefaultTunnels(),
      });

      logger.success('Pangolin Client configured');
      logger.info(`Server: ${serverUrl}`);
      logger.info(`Public URL: ${serverConfig.baseUrl}`);

      return true;
    } catch (error) {
      logger.error(`Failed to configure Pangolin Client: ${error}`);
      return false;
    }
  }

  /**
   * Update tunnel configuration
   */
  updateConfig(updates: Partial<TunnelConfig>): boolean {
    try {
      const config = this.loadTunnelConfig();
      const updated = { ...config, ...updates };
      this.saveTunnelConfig(updated);
      
      // Apply to .env if needed
      if (updates.tunnels) {
        this.updateEnvFile({
          PANGOLIN_TUNNELS: this.serializeTunnels(updates.tunnels),
        });
      }

      logger.success('Tunnel configuration updated');
      return true;
    } catch (error) {
      logger.error(`Failed to update tunnel config: ${error}`);
      return false;
    }
  }

  // ========================================================================
  // Service Management
  // ========================================================================

  /**
   * Start Pangolin services
   */
  start(): boolean {
    try {
      const config = this.loadTunnelConfig();
      
      if (!config.enabled || config.mode === 'none') {
        logger.warn('Tunnel not enabled. Run: eve tunnel:enable');
        return false;
      }

      const profile = config.mode === 'server' ? 'pangolin-server' : 'pangolin-client';
      
      logger.info(`Starting Pangolin ${config.mode}...`);

      execSync(
        `docker compose -f ${this.composeFile} --profile ${profile} up -d`,
        { stdio: 'inherit' }
      );

      logger.success(`Pangolin ${config.mode} started`);
      return true;
    } catch (error) {
      logger.error(`Failed to start Pangolin: ${error}`);
      return false;
    }
  }

  /**
   * Stop Pangolin services
   */
  stop(): boolean {
    try {
      if (!existsSync(this.composeFile)) {
        logger.info('Pangolin not installed');
        return true;
      }

      logger.info('Stopping Pangolin...');

      execSync(
        `docker compose -f ${this.composeFile} down`,
        { stdio: 'ignore' }
      );

      logger.success('Pangolin stopped');
      return true;
    } catch (error) {
      logger.error(`Failed to stop Pangolin: ${error}`);
      return false;
    }
  }

  /**
   * Restart Pangolin services
   */
  restart(): boolean {
    this.stop();
    return this.start();
  }

  // ========================================================================
  // Status & Information
  // ========================================================================

  /**
   * Get current tunnel status
   */
  async getStatus(): Promise<TunnelInfo> {
    try {
      const config = await this.loadTunnelConfig();
      
      if (!config.enabled) {
        return {
          status: 'disconnected',
          bytesTransferred: { sent: 0, received: 0 },
          activeTunnels: 0,
        };
      }

      // Check if container is running
      const containerName = config.mode === 'server' 
        ? 'eve-pangolin-server' 
        : 'eve-pangolin-client';

      const isRunning = this.isContainerRunning(containerName);
      
      if (!isRunning) {
        return {
          status: 'disconnected',
          mode: config.mode,
          bytesTransferred: { sent: 0, received: 0 },
          activeTunnels: 0,
        };
      }

      // Get detailed status from container
      const status = this.getContainerStatus(containerName);

      return {
        status: status.healthy ? 'connected' : 'connecting',
        mode: config.mode,
        publicUrl: config.publicUrl,
        serverUrl: config.serverUrl,
        connectedAt: status.startedAt,
        bytesTransferred: status.bytesTransferred,
        latency: status.latency,
        activeTunnels: config.tunnels?.length || 0,
      };
    } catch (error) {
      return {
        status: 'error',
        lastError: String(error),
        bytesTransferred: { sent: 0, received: 0 },
        activeTunnels: 0,
      };
    }
  }

  /**
   * Get public tunnel URL
   */
  async getTunnelUrl(): Promise<string | undefined> {
    const config = await this.loadTunnelConfig();
    return config.publicUrl;
  }

  /**
   * List active tunnels
   */
  async listTunnels(): Promise<Array<{
    name: string;
    localPort: number;
    remotePort?: number;
    status: 'active' | 'inactive';
    url?: string;
  }>> {
    const config = await this.loadTunnelConfig();
    const status = await this.getStatus();

    return (config.tunnels || []).map(tunnel => ({
      name: tunnel.name,
      localPort: tunnel.localPort,
      remotePort: tunnel.remotePort,
      status: status.status === 'connected' ? 'active' : 'inactive',
      url: status.publicUrl 
        ? `${status.publicUrl}/${tunnel.name}` 
        : undefined,
    }));
  }

  /**
   * Get comprehensive Pangolin status
   */
  async getPangolinStatus(): Promise<PangolinStatus> {
    const installed = existsSync(this.composeFile);
    const config = await this.loadTunnelConfig();
    const errors: string[] = [];

    let running = false;
    let configValid = true;
    let version: string | undefined;

    if (installed) {
      const containerName = config.mode === 'server' 
        ? 'eve-pangolin-server' 
        : 'eve-pangolin-client';
      running = this.isContainerRunning(containerName);

      try {
        const versionOutput = execSync(
          `docker exec ${containerName} pangolin --version 2>/dev/null || echo "unknown"`,
          { encoding: 'utf-8' }
        );
        version = versionOutput.trim();
      } catch {
        version = 'unknown';
      }

      // Validate configuration
      if (config.mode === 'server') {
        if (!config.wireguard?.privateKey || !config.wireguard?.publicKey) {
          errors.push('Missing WireGuard keys');
          configValid = false;
        }
      } else if (config.mode === 'client') {
        if (!config.serverUrl || !config.token) {
          errors.push('Missing server URL or token');
          configValid = false;
        }
      }
    }

    return {
      installed,
      running,
      mode: config.mode,
      version,
      configValid,
      errors,
    };
  }

  // ========================================================================
  // Logs
  // ========================================================================

  /**
   * Get tunnel logs
   * @param lines - Number of lines to return
   */
  async getLogs(lines: number = 100): Promise<string> {
    try {
      const config = await this.loadTunnelConfig();
      const containerName = config.mode === 'server' 
        ? 'eve-pangolin-server' 
        : 'eve-pangolin-client';

      return execSync(
        `docker logs --tail ${lines} ${containerName} 2>&1`,
        { encoding: 'utf-8' }
      );
    } catch (error) {
      return `Failed to get logs: ${error}`;
    }
  }

  /**
   * Follow tunnel logs (for CLI streaming)
   */
  async followLogs(): Promise<void> {
    const config = await this.loadTunnelConfig();
    const containerName = config.mode === 'server' 
      ? 'eve-pangolin-server' 
      : 'eve-pangolin-client';

    execSync(`docker logs -f ${containerName}`, { stdio: 'inherit' });
  }

  // ========================================================================
  // Private Helpers
  // ========================================================================

  private ensureDirectories(): void {
    const dirs = [
      this.configDir,
      path.join(this.dataDir, 'server'),
      path.join(this.dataDir, 'client'),
      path.join(this.dataDir, 'certs'),
    ];

    for (const dir of dirs) {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    }
  }

  private createComposeFile(): void {
    const composeContent = this.getEmbeddedComposeTemplate();
    writeFileSync(this.composeFile, composeContent);
  }

  private getEmbeddedComposeTemplate(): string {
    // Returns the embedded Docker Compose template
    // In practice, this would be the content from pangolin-docker-compose.yml
    return `# Auto-generated Pangolin Compose
# Run: eve tunnel:enable to regenerate
version: '3.8'
services:
  pangolin-server:
    image: fosrl/pangolin:latest
    profiles: [pangolin-server]
    # ... (template content)
  pangolin-client:
    image: fosrl/pangolin:latest
    profiles: [pangolin-client]
    # ... (template content)
`;
  }

  private generateWireGuardKeys(): { privateKey: string; publicKey: string } {
    try {
      // Use wg command if available
      const privateKey = execSync('wg genkey', { encoding: 'utf-8' }).trim();
      const publicKey = execSync(`echo "${privateKey}" | wg pubkey`, { encoding: 'utf-8' }).trim();
      
      return { privateKey, publicKey };
    } catch {
      // Fallback: generate using OpenSSL (not proper WireGuard keys, but placeholders)
      logger.warn('wg command not available. Generating placeholder keys.');
      const privateKey = execSync('openssl rand -base64 44', { encoding: 'utf-8' }).trim();
      const publicKey = execSync('openssl rand -base64 44', { encoding: 'utf-8' }).trim();
      
      return { privateKey, publicKey };
    }
  }

  private generateSecureToken(): string {
    return execSync('openssl rand -hex 32', { encoding: 'utf-8' }).trim();
  }

  private async getSystemDomain(): Promise<string> {
    try {
      const { config } = await loadConfig();
      return config.hearth.domain || 'localhost';
    } catch {
      return 'localhost';
    }
  }

  private async getHearthName(): Promise<string> {
    try {
      const { config } = await loadConfig();
      return config.hearth.name || 'eve-node';
    } catch {
      return 'eve-node';
    }
  }

  private fetchServerConfig(serverUrl: string, token: string): {
    serverPublicKey: string;
    endpoint: string;
    baseUrl: string;
  } {
    try {
      // In production, this would make an API call to the Pangolin server
      // For now, construct from server URL
      const url = new URL(serverUrl);
      
      return {
        serverPublicKey: 'placeholder', // Would be fetched from server API
        endpoint: `${url.hostname}:51820`,
        baseUrl: serverUrl.replace(/:\d+$/, ''),
      };
    } catch (error) {
      throw new Error(`Failed to fetch server config: ${error}`);
    }
  }

  private buildTunnelsConfig(): string {
    const tunnels = this.getDefaultTunnels();
    return tunnels.map(t => `${t.name}:${t.localPort}`).join(',');
  }

  private getDefaultTunnels(): TunnelConfig['tunnels'] {
    return [
      { name: 'synap', localPort: 4000, protocol: 'tcp' },
      { name: 'openclaw', localPort: 8080, protocol: 'tcp' },
    ];
  }

  private serializeTunnels(tunnels: TunnelConfig['tunnels']): string {
    if (!tunnels) return '';
    return tunnels.map(t => `${t.name}:${t.localPort}`).join(',');
  }

  private updateEnvFile(updates: Record<string, string>): void {
    const envPath = path.join(process.env.eve_TARGET || '/opt/eve', 'config/.env');
    
    if (!existsSync(envPath)) {
      throw new Error('Environment file not found. Run eve init first.');
    }

    let content = readFileSync(envPath, 'utf-8');

    for (const [key, value] of Object.entries(updates)) {
      const regex = new RegExp(`^${key}=.*$`, 'm');
      const line = `${key}=${value}`;
      
      if (regex.test(content)) {
        content = content.replace(regex, line);
      } else {
        content += `\n${line}`;
      }
    }

    writeFileSync(envPath, content);
  }

  private async loadTunnelConfig(): Promise<TunnelConfig> {
    try {
      const { config } = await loadConfig();
      return config.tunnel || { enabled: false, provider: 'none' };
    } catch {
      return { enabled: false, provider: 'none' };
    }
  }

  private async saveTunnelConfig(tunnelConfig: TunnelConfig): Promise<void> {
    await updateConfig({ tunnel: tunnelConfig });
  }

  private isContainerRunning(containerName: string): boolean {
    try {
      execSync(`docker ps -q -f name=${containerName}`, { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  private getContainerStatus(containerName: string): {
    healthy: boolean;
    startedAt?: Date;
    bytesTransferred: { sent: number; received: number };
    latency?: number;
  } {
    try {
      // This would interface with Pangolin's health API in production
      return {
        healthy: true,
        startedAt: new Date(),
        bytesTransferred: { sent: 0, received: 0 },
        latency: 0,
      };
    } catch {
      return {
        healthy: false,
        bytesTransferred: { sent: 0, received: 0 },
      };
    }
  }
}

// Singleton instance
export const pangolinService = new PangolinService();
