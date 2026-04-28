import { exec } from 'child_process';
import { promisify } from 'util';

import { execa, resolveSynapDelegate } from '@eve/brain';

const execAsync = promisify(exec);

export interface Feed {
  name: string;
  url: string;
  lastFetch?: Date;
  status: 'active' | 'paused' | 'error';
}

export interface RSSHubConfig {
  port: number;
}

export class RSSHubService {
  private config: RSSHubConfig;
  private feeds: Feed[] = [];

  constructor(config: Partial<RSSHubConfig> = {}) {
    this.config = {
      port: config.port ?? 1200,
    };
  }

  /**
   * Check if RSSHub is installed
   */
  async isInstalled(): Promise<boolean> {
    try {
      const { stdout } = await execAsync(
        'docker images diygod/rsshub --format "{{.Repository}}"'
      );
      return stdout.trim() === 'diygod/rsshub';
    } catch {
      return false;
    }
  }

  /**
   * Check if RSSHub container is running
   */
  async isRunning(): Promise<boolean> {
    try {
      const { stdout } = await execAsync(
        'docker ps --filter "name=eve-eyes-rsshub" --format "{{.Names}}"'
      );
      return stdout.trim() === 'eve-eyes-rsshub';
    } catch {
      return false;
    }
  }

  /**
   * Install RSSHub container
   */
  async install(config?: Partial<RSSHubConfig>): Promise<void> {
    const synapPod = resolveSynapDelegate();
    if (synapPod) {
      console.log('RSSHub: enabling Synap compose profile (rsshub + browserless)...');
      await execa('bash', [synapPod.synapScript, 'profiles', 'enable', 'rsshub'], {
        cwd: synapPod.repoRoot,
        env: { ...process.env, SYNAP_DEPLOY_DIR: synapPod.deployDir },
        stdio: 'inherit',
      });
      return;
    }

    const port = config?.port ?? this.config.port;

    const alreadyRunning = await this.isRunning();
    if (alreadyRunning) {
      console.log('RSSHub is already running');
      return;
    }

    console.log(`Pulling RSSHub image...`);
    await execAsync('docker pull diygod/rsshub:latest');

    console.log(`Starting RSSHub on port ${port}...`);
    await execAsync(
      `docker run -d --name eve-eyes-rsshub --network eve-network -p ${port}:1200 diygod/rsshub:latest`,
    );
  }

  /**
   * Start RSSHub container
   */
  async start(): Promise<void> {
    const synapPod = resolveSynapDelegate();
    if (synapPod) {
      await execa('bash', [synapPod.synapScript, 'profiles', 'enable', 'rsshub'], {
        cwd: synapPod.repoRoot,
        env: { ...process.env, SYNAP_DEPLOY_DIR: synapPod.deployDir },
        stdio: 'inherit',
      });
      console.log('RSSHub profile started (Synap stack)');
      return;
    }

    if (await this.isRunning()) {
      console.log('RSSHub is already running');
      return;
    }
    await execAsync('docker start eve-eyes-rsshub');
    console.log('RSSHub started');
  }

  /**
   * Stop RSSHub container
   */
  async stop(): Promise<void> {
    await execAsync('docker stop eve-eyes-rsshub');
    console.log('RSSHub stopped');
  }

  /**
   * Add a feed
   */
  async addFeed(name: string, url: string): Promise<void> {
    this.feeds.push({
      name,
      url,
      status: 'active',
      lastFetch: new Date(),
    });
    console.log(`Feed "${name}" added`);
  }

  /**
   * List all feeds
   */
  async listFeeds(): Promise<Feed[]> {
    return this.feeds;
  }

  /**
   * Remove a feed
   */
  async removeFeed(name: string): Promise<void> {
    this.feeds = this.feeds.filter(f => f.name !== name);
    console.log(`Feed "${name}" removed`);
  }

  /**
   * Sync feeds to Brain
   */
  async syncToBrain(): Promise<void> {
    console.log(`Syncing ${this.feeds.length} feeds to Brain...`);
    // Implementation would send feeds to Brain API
  }
}
