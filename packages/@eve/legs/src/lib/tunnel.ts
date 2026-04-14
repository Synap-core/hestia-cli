import { execSync } from 'child_process';
import { writeFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';

export interface TunnelConfig {
  provider: 'pangolin' | 'cloudflare';
  domain: string;
  apiKey?: string;
  tunnelId?: string;
}

export class TunnelService {
  private configDir: string;

  constructor(configDir: string = '/opt/hestia/tunnels') {
    this.configDir = configDir;

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

    console.log('Pangolin configured successfully');
  }

  async setupCloudflare(config?: { domain?: string; apiToken?: string }): Promise<void> {
    console.log('Setting up Cloudflare tunnel...');

    // Check if cloudflared is installed
    try {
      execSync('which cloudflared', { stdio: 'ignore' });
      console.log('cloudflared already installed');
    } catch {
      console.log('Installing cloudflared...');
      execSync('npm install -g cloudflared', { stdio: 'inherit' });
    }

    const cfConfig = {
      tunnel: null,
      'credentials-file': join(this.configDir, 'cloudflare-credentials.json'),
      ingress: [
        {
          hostname: config?.domain,
          service: 'http://localhost:3000'
        },
        {
          service: 'http_status:404'
        }
      ]
    };

    writeFileSync(
      join(this.configDir, 'cloudflare.yml'),
      JSON.stringify(cfConfig, null, 2)
    );

    console.log('Cloudflare tunnel configured');
  }

  startTunnel(provider: 'pangolin' | 'cloudflare'): void {
    console.log(`Starting ${provider} tunnel...`);
    
    if (provider === 'pangolin') {
      execSync('pangolin start', { stdio: 'inherit' });
    } else {
      execSync('cloudflared tunnel run', { stdio: 'inherit' });
    }
  }

  stopTunnel(provider: 'pangolin' | 'cloudflare'): void {
    console.log(`Stopping ${provider} tunnel...`);
    
    try {
      if (provider === 'pangolin') {
        execSync('pkill pangolin', { stdio: 'ignore' });
      } else {
        execSync('pkill cloudflared', { stdio: 'ignore' });
      }
      console.log(`${provider} tunnel stopped`);
    } catch {
      console.log(`${provider} tunnel was not running`);
    }
  }

  getConfig(): TunnelConfig | null {
    try {
      const configPath = join(this.configDir, 'config.json');
      if (!existsSync(configPath)) {
        return null;
      }
      return JSON.parse(readFileSync(configPath, 'utf-8'));
    } catch {
      return null;
    }
  }
}
