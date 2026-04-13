import { exec } from 'child_process';
import { promisify } from 'util';
import { HestiaEntityManager } from '@hestia/dna';

const execAsync = promisify(exec);

export interface Feed {
  name: string;
  url: string;
  lastFetch?: Date;
  status: 'active' | 'paused' | 'error';
}

export interface RSSHubConfig {
  containerName: string;
  port: number;
  brainApiUrl: string;
  feedsPath: string;
}

export class RSSHubService {
  private config: RSSHubConfig;
  private entityManager: HestiaEntityManager;
  private feeds: Feed[] = [];

  constructor(
    entityManager: HestiaEntityManager,
    config: Partial<RSSHubConfig> = {}
  ) {
    this.entityManager = entityManager;
    this.config = {
      containerName: config.containerName ?? 'rsshub',
      port: config.port ?? 1200,
      brainApiUrl: config.brainApiUrl ?? 'http://localhost:3000/api',
      feedsPath: config.feedsPath ?? '~/.config/hestia/feeds.json'
    };
  }

  /**
   * Check if RSSHub container is running
   */
  async isRunning(): Promise<boolean> {
    try {
      const { stdout } = await execAsync(
        `docker ps --filter "name=${this.config.containerName}" --format "{{.Names}}"`
      );
      return stdout.trim() === this.config.containerName;
    } catch {
      return false;
    }
  }

  /**
   * Install RSSHub container
   */
  async install(): Promise<void> {
    console.log('Installing RSSHub...');

    try {
      // Pull RSSHub image
      console.log('Pulling RSSHub Docker image...');
      await execAsync('docker pull diygod/rsshub:latest');

      // Create feeds directory
      await execAsync(`mkdir -p ~/.config/hestia`);

      // Initialize empty feeds file
      await execAsync(
        `echo '[]' > ${this.config.feedsPath}`
      );

      // Create RSSHub container
      console.log('Creating RSSHub container...');
      await execAsync(
        `docker run -d ` +
        `--name ${this.config.containerName} ` +
        `-p ${this.config.port}:1200 ` +
        `-v ${this.config.feedsPath}:/app/feeds.json:ro ` +
        `-e NODE_ENV=production ` +
        `-e CACHE_TYPE=memory ` +
        `--restart unless-stopped ` +
        `diygod/rsshub:latest`
      );

      // Register with entity manager
      await this.entityManager.create('rsshub_instance', {
        containerName: this.config.containerName,
        port: this.config.port,
        brainApiUrl: this.config.brainApiUrl,
        installedAt: new Date().toISOString(),
        status: 'installed'
      });

      console.log('RSSHub installed successfully!');
      console.log(`RSSHub is available at: http://localhost:${this.config.port}`);
    } catch (error) {
      console.error('Failed to install RSSHub:', error);
      throw error;
    }
  }

  /**
   * Start RSSHub container
   */
  async start(): Promise<void> {
    console.log('Starting RSSHub...');

    try {
      if (await this.isRunning()) {
        console.log('RSSHub is already running');
        return;
      }

      await execAsync(`docker start ${this.config.containerName}`);
      console.log('RSSHub started successfully');

      await this.entityManager.update(
        { type: 'rsshub_instance' },
        { status: 'running' }
      );
    } catch (error) {
      console.error('Failed to start RSSHub:', error);
      throw error;
    }
  }

  /**
   * Stop RSSHub container
   */
  async stop(): Promise<void> {
    console.log('Stopping RSSHub...');

    try {
      await execAsync(`docker stop ${this.config.containerName}`);
      console.log('RSSHub stopped successfully');

      await this.entityManager.update(
        { type: 'rsshub_instance' },
        { status: 'stopped' }
      );
    } catch (error) {
      console.error('Failed to stop RSSHub:', error);
      throw error;
    }
  }

  /**
   * Add a new RSS feed
   */
  async addFeed(name: string, url: string): Promise<void> {
    console.log(`Adding feed: ${name} (${url})`);

    const feed: Feed = {
      name,
      url,
      status: 'active'
    };

    this.feeds.push(feed);
    await this.saveFeeds();

    // Register feed in entity manager
    await this.entityManager.create('feed', {
      name,
      url,
      status: 'active',
      addedAt: new Date().toISOString()
    });

    console.log(`Feed "${name}" added successfully`);
  }

  /**
   * Remove an RSS feed
   */
  async removeFeed(name: string): Promise<void> {
    console.log(`Removing feed: ${name}`);

    const index = this.feeds.findIndex(f => f.name === name);
    if (index === -1) {
      throw new Error(`Feed "${name}" not found`);
    }

    this.feeds.splice(index, 1);
    await this.saveFeeds();

    await this.entityManager.delete({ type: 'feed', name });

    console.log(`Feed "${name}" removed successfully`);
  }

  /**
   * List all feeds
   */
  async listFeeds(): Promise<Feed[]> {
    await this.loadFeeds();
    return [...this.feeds];
  }

  /**
   * Sync consumed content to Brain
   */
  async syncToBrain(): Promise<void> {
    console.log('Syncing RSS content to Brain...');

    try {
      const response = await fetch(
        `http://localhost:${this.config.port}/api/routes`
      );
      
      if (!response.ok) {
        throw new Error(`RSSHub responded with ${response.status}`);
      }

      const routes = await response.json();
      
      for (const feed of this.feeds) {
        if (feed.status !== 'active') continue;

        try {
          const feedResponse = await fetch(
            `http://localhost:${this.config.port}${feed.url}`
          );

          if (!feedResponse.ok) {
            console.warn(`Failed to fetch feed "${feed.name}": ${feedResponse.status}`);
            continue;
          }

          const content = await feedResponse.json();
          
          // Send to Brain API
          await this.sendToBrain(feed, content);
          
          feed.lastFetch = new Date();
        } catch (error) {
          console.error(`Error processing feed "${feed.name}":`, error);
          feed.status = 'error';
        }
      }

      await this.saveFeeds();
      console.log('Sync completed');
    } catch (error) {
      console.error('Failed to sync to Brain:', error);
      throw error;
    }
  }

  /**
   * Send feed content to Brain API
   */
  private async sendToBrain(feed: Feed, content: unknown): Promise<void> {
    const payload = {
      source: 'rsshub',
      feedName: feed.name,
      feedUrl: feed.url,
      timestamp: new Date().toISOString(),
      content
    };

    const response = await fetch(`${this.config.brainApiUrl}/ingest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Brain API responded with ${response.status}`);
    }
  }

  /**
   * Load feeds from disk
   */
  private async loadFeeds(): Promise<void> {
    try {
      const { stdout } = await execAsync(`cat ${this.config.feedsPath}`);
      this.feeds = JSON.parse(stdout);
    } catch {
      this.feeds = [];
    }
  }

  /**
   * Save feeds to disk
   */
  private async saveFeeds(): Promise<void> {
    await execAsync(
      `echo '${JSON.stringify(this.feeds)}' > ${this.config.feedsPath}`
    );
  }
}
