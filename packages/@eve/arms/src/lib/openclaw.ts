import { spawn } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';
import { readEveSecrets } from '@eve/dna';

export interface MCPConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface OpenClawConfig {
  ollamaUrl: string;
  model?: string;
  synapApiUrl?: string;
  synapApiKey?: string;
  dokployApiUrl?: string;
  mcpServers?: Record<string, MCPConfig>;
  /** Messaging platform bridges */
  messaging?: {
    enabled?: boolean;
    platform?: 'telegram' | 'signal' | 'matrix';
    botToken?: string;
  };
  /** Voice / telephony config */
  voice?: {
    enabled?: boolean;
    provider?: 'twilio' | 'signal' | 'selfhosted';
    phoneNumber?: string;
    sipUri?: string;
  };
}

const OPENCLAW_CONTAINER = 'eve-arms-openclaw';
const OPENCLAW_PORT = 3000;

export class OpenClawService {
  private config: OpenClawConfig = {
    ollamaUrl: 'http://eve-brain-ollama:11434',
    model: 'llama3.2',
  };

  /**
   * Install OpenClaw container
   */
  async install(): Promise<void> {
    console.log('📦 Installing OpenClaw...');

    // Pull the OpenClaw image
    await this.runDockerCommand([
      'pull',
      'ghcr.io/openclaw/openclaw:latest',
    ]);

    console.log('✅ OpenClaw image pulled');
  }

  /**
   * Configure OpenClaw to use Ollama
   */
  async configure(ollamaUrl: string): Promise<void> {
    this.config.ollamaUrl = ollamaUrl;
    console.log(`⚙️  Configured OpenClaw to use Ollama at ${ollamaUrl}`);
  }

  setIntegration(integration: { synapApiUrl?: string; synapApiKey?: string; dokployApiUrl?: string }): void {
    this.config.synapApiUrl = integration.synapApiUrl;
    this.config.synapApiKey = integration.synapApiKey;
    this.config.dokployApiUrl = integration.dokployApiUrl;
  }

  /**
   * Configure messaging platform (Telegram, Signal, Matrix).
   * Writes config and updates running container with env vars.
   */
  async configureMessaging(platform: 'telegram' | 'signal' | 'matrix', config: { botToken?: string }): Promise<void> {
    console.log(`Configuring ${platform} messaging...`);
    this.config.messaging = { ...this.config.messaging, enabled: true, platform, ...config };
    console.log(`✅ ${platform} messaging configured`);
  }

  /**
   * Configure voice/telephony (Twilio, Signal, self-hosted SIP).
   */
  async configureVoice(config: {
    provider?: 'twilio' | 'signal' | 'selfhosted';
    phoneNumber?: string;
    sipUri?: string;
  }): Promise<void> {
    console.log('Configuring voice/telephony...');
    this.config.voice = { ...this.config.voice, enabled: true, ...config };
    console.log('✅ Voice configured');
  }

  /**
   * Start OpenClaw container.
   *
   * Messaging and voice config are read from Eve secrets at start time so
   * that env vars always reflect persisted configuration — not just in-memory
   * state that disappears on restart.
   */
  async start(): Promise<void> {
    const isRunning = await this.isRunning();
    if (isRunning) {
      console.log('🤖 OpenClaw is already running');
      return;
    }

    console.log('🚀 Starting OpenClaw...');

    // Merge persisted secrets over in-memory config so restart always picks
    // up the saved messaging/voice settings even if configure* was never called
    // in this process.
    const secrets = await readEveSecrets().catch(() => null);
    const messaging = secrets?.arms?.messaging ?? this.config.messaging;
    const voice = secrets?.arms?.voice ?? this.config.voice;

    await this.runDockerCommand([
      'run',
      '-d',
      '--name', OPENCLAW_CONTAINER,
      '--network', 'eve-network',
      '-p', `${OPENCLAW_PORT}:3000`,
      '-e', `OLLAMA_URL=${this.config.ollamaUrl}`,
      '-e', `DEFAULT_MODEL=${this.config.model}`,
      '-e', `SYNAP_API_URL=${this.config.synapApiUrl ?? ''}`,
      '-e', `SYNAP_API_KEY=${this.config.synapApiKey ?? ''}`,
      '-e', `DOKPLOY_API_URL=${this.config.dokployApiUrl ?? ''}`,
      '-e', `MESSAGING_ENABLED=${messaging?.enabled ?? false}`,
      '-e', `MESSAGING_PLATFORM=${messaging?.platform ?? ''}`,
      '-e', `MESSAGING_BOT_TOKEN=${messaging?.botToken ?? ''}`,
      '-e', `VOICE_ENABLED=${voice?.enabled ?? false}`,
      '-e', `VOICE_PROVIDER=${voice?.provider ?? ''}`,
      '-e', `VOICE_PHONE_NUMBER=${voice?.phoneNumber ?? ''}`,
      '-e', `VOICE_SIP_URI=${voice?.sipUri ?? ''}`,
      '-v', 'eve-arms-openclaw-data:/data',
      '--restart', 'unless-stopped',
      'ghcr.io/openclaw/openclaw:latest',
    ]);

    // Wait for service to be ready
    await setTimeout(3000);

    console.log(`✅ OpenClaw started on port ${OPENCLAW_PORT}`);
  }

  /**
   * Stop OpenClaw container
   */
  async stop(): Promise<void> {
    const isRunning = await this.isRunning();
    if (!isRunning) {
      console.log('🤖 OpenClaw is not running');
      return;
    }

    console.log('🛑 Stopping OpenClaw...');

    await this.runDockerCommand(['stop', OPENCLAW_CONTAINER]);
    await this.runDockerCommand(['rm', OPENCLAW_CONTAINER]);

    console.log('✅ OpenClaw stopped');
  }

  /**
   * Check if OpenClaw is running
   */
  async isRunning(): Promise<boolean> {
    try {
      const output = await this.runDockerCommand(
        ['ps', '--filter', `name=${OPENCLAW_CONTAINER}`, '--format', '{{.Names}}'],
        true
      );
      return output.includes(OPENCLAW_CONTAINER);
    } catch {
      return false;
    }
  }

  /**
   * Install an MCP server
   */
  async installMCPServer(name: string, config: MCPConfig): Promise<void> {
    console.log(`🔌 Installing MCP server: ${name}...`);

    const mcpConfig = {
      mcpServers: {
        [name]: config,
      },
    };

    // Write config to container
    const configJson = JSON.stringify(mcpConfig);
    await this.runDockerCommand([
      'exec', OPENCLAW_CONTAINER,
      'sh', '-c',
      `echo '${configJson}' > /data/mcp-${name}.json`,
    ]);

    console.log(`✅ MCP server ${name} installed`);
  }

  /**
   * List installed MCP servers
   */
  async listMCPServers(): Promise<string[]> {
    try {
      const output = await this.runDockerCommand(
        ['exec', OPENCLAW_CONTAINER, 'ls', '/data/'],
        true
      );
      
      return output
        .split('\n')
        .filter(f => f.startsWith('mcp-') && f.endsWith('.json'))
        .map(f => f.replace('mcp-', '').replace('.json', ''));
    } catch {
      return [];
    }
  }

  /**
   * Get OpenClaw status
   */
  async getStatus(): Promise<{ running: boolean; url: string; model: string }> {
    const running = await this.isRunning();
    return {
      running,
      url: `http://localhost:${OPENCLAW_PORT}`,
      model: this.config.model || 'llama3.2',
    };
  }

  /**
   * Run a Docker command and return output
   */
  private runDockerCommand(args: string[], returnOutput = false): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn('docker', args, {
        stdio: returnOutput ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      });

      let output = '';
      if (returnOutput) {
        proc.stdout?.on('data', (data) => {
          output += data.toString();
        });
      }

      proc.on('close', (code) => {
        if (code === 0) {
          resolve(output.trim());
        } else {
          reject(new Error(`Docker command failed with code ${code}`));
        }
      });

      proc.on('error', reject);
    });
  }
}

// Singleton instance
export const openclaw = new OpenClawService();
