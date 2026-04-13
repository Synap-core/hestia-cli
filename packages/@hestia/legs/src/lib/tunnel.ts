import { execSync } from 'child_process';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { EntityState } from '@hestia/dna';

export interface TunnelConfig {
  provider: 'pangolin' | 'cloudflare';
  domain: string;
  apiKey?: string;
  tunnelId?: string;
}

export class TunnelService {
  private configDir: string;
  private state: EntityState;

  constructor(configDir: string = '/opt/hestia/tunnels') {
    this.configDir = configDir;
    this.state = new EntityState('legs-tunnel');

    if (!existsSync(this.configDir)) {
      mkdirSync(this.configDir, { recursive: true });
    }
  }

  async setupPangolin(config?: { domain?: string; server?: string }): Promise<void> {
    console.log('Setting up Pangolin tunnel...');

    // Check if Pangolin is already installed
    try {
      execSync('which pangolin', { stdio: 'ignore' });
      console.log('Pangolin CLI already installed');
    } catch {
      console.log('Installing Pangolin CLI...');
      execSync('curl -fsSL https://get.pangolin.cloud | sh', { stdio: 'inherit' });
    }

    // Create Pangolin configuration
    const pangolinConfig = {
      server: config?.server || 'pangolin.to',
      domain: config?.domain,
      autoUpdate: true
    };

    writeFileSync(
      join(this.configDir, 'pangolin.json'),
      JSON.stringify(pangolinConfig, null, 2)
    );

    await this.state.update({
      provider: 'pangolin',
      domain: config?.domain,
      server: config?.server,
      configuredAt: new Date().toISOString()
    });

    console.log('Pangolin tunnel configured');
    console.log('Note: You may need to authenticate with pangolin auth login');
  }

  async setupCloudflare(config?: { tunnelName?: string; domain?: string; apiToken?: string }): Promise<void> {
    console.log('Setting up Cloudflare tunnel...');

    // Check if cloudflared is installed
    try {
      execSync('which cloudflared', { stdio: 'ignore' });
      console.log('cloudflared already installed');
    } catch {
      console.log('Installing cloudflared...');
      execSync(`
        curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o /tmp/cloudflared.deb && \
        dpkg -i /tmp/cloudflared.deb || apt-get install -f -y
      `, { stdio: 'inherit' });
    }

    const tunnelName = config?.tunnelName || 'hestia-tunnel';
    const domain = config?.domain;

    // Create Cloudflare configuration
    const cloudflareConfig = `
tunnel: ${tunnelName}
credentials-file: ${join(this.configDir, '.cloudflared', `${tunnelName}.json`)}

ingress:
  - hostname: ${domain || '*.'}
    service: http://localhost:80
  - service: http_status:404
`;

    const cloudflaredDir = join(this.configDir, '.cloudflared');
    if (!existsSync(cloudflaredDir)) {
      mkdirSync(cloudflaredDir, { recursive: true });
    }

    writeFileSync(
      join(cloudflaredDir, 'config.yml'),
      cloudflareConfig.trim()
    );

    // Create systemd service for Cloudflare tunnel
    const systemdService = `
[Unit]
Description=Cloudflare Tunnel
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/cloudflared tunnel run ${tunnelName}
Restart=always
RestartSec=5
Environment="TUNNEL_TOKEN=${config?.apiToken || ''}"

[Install]
WantedBy=multi-user.target
`;

    writeFileSync('/etc/systemd/system/cloudflared-tunnel.service', systemdService.trim());
    execSync('systemctl daemon-reload', { stdio: 'inherit' });

    await this.state.update({
      provider: 'cloudflare',
      tunnelName,
      domain,
      configuredAt: new Date().toISOString()
    });

    console.log('Cloudflare tunnel configured');
    console.log(`Tunnel name: ${tunnelName}`);

    if (!config?.apiToken) {
      console.log('\nTo complete setup:');
      console.log('1. Authenticate: cloudflared tunnel login');
      console.log(`2. Create tunnel: cloudflared tunnel create ${tunnelName}`);
      console.log(`3. Start tunnel: systemctl enable --now cloudflared-tunnel`);
    } else {
      execSync('systemctl enable --now cloudflared-tunnel', { stdio: 'inherit' });
    }
  }

  async startTunnel(): Promise<void> {
    const state = await this.state.get();

    if (!state.provider) {
      throw new Error('No tunnel provider configured');
    }

    if (state.provider === 'cloudflare') {
      execSync('systemctl enable --now cloudflared-tunnel', { stdio: 'inherit' });
    } else if (state.provider === 'pangolin') {
      console.log('Pangolin tunnels are managed by the Pangolin daemon');
      console.log('Run: pangolin tunnel up');
    }

    await this.state.update({ status: 'running' });
  }

  async stopTunnel(): Promise<void> {
    const state = await this.state.get();

    if (state.provider === 'cloudflare') {
      execSync('systemctl stop cloudflared-tunnel', { stdio: 'inherit' });
    }

    await this.state.update({ status: 'stopped' });
  }

  async getConfig(): Promise<TunnelConfig | null> {
    const state = await this.state.get();

    if (!state.provider) {
      return null;
    }

    return {
      provider: state.provider,
      domain: state.domain,
      tunnelId: state.tunnelId
    };
  }
}
