import { execa } from 'execa';
import { logger } from '@hestia/dna';

export interface SynapHealth {
  status: 'healthy' | 'unhealthy' | 'starting';
  version?: string;
  uptime?: number;
}

export class SynapService {
  private containerName = 'hestia-synap';
  private image = 'synap/backend:latest';

  async install(): Promise<void> {
    logger.info('Installing Synap backend...');
    
    // Pull the latest image
    await execa('docker', ['pull', this.image], { stdio: 'inherit' });
    
    logger.success('Synap backend image pulled successfully');
  }

  async start(): Promise<void> {
    logger.info('Starting Synap backend...');

    // Check if already running
    const running = await this.isRunning();
    if (running) {
      logger.info('Synap backend is already running');
      return;
    }

    // Check if container exists but is stopped
    const exists = await this.containerExists();
    if (exists) {
      await execa('docker', ['start', this.containerName], { stdio: 'inherit' });
    } else {
      // Create and start new container
      await execa('docker', [
        'run',
        '-d',
        '--name', this.containerName,
        '--network', 'hestia-network',
        '-p', '4000:4000',
        '-e', 'NODE_ENV=production',
        '-e', 'DATABASE_URL=postgresql://hestia:hestia@hestia-postgres:5432/synap',
        '-e', 'REDIS_URL=redis://hestia-redis:6379',
        '-e', 'JWT_SECRET=hestia-local-dev-secret',
        '--restart', 'unless-stopped',
        this.image
      ], { stdio: 'inherit' });
    }

    logger.success('Synap backend started on port 4000');
  }

  async stop(): Promise<void> {
    logger.info('Stopping Synap backend...');
    
    const running = await this.isRunning();
    if (!running) {
      logger.info('Synap backend is not running');
      return;
    }

    await execa('docker', ['stop', this.containerName], { stdio: 'inherit' });
    logger.success('Synap backend stopped');
  }

  async isHealthy(): Promise<boolean> {
    try {
      const { stdout } = await execa('docker', [
        'inspect',
        '--format', '{{.State.Health.Status}}',
        this.containerName
      ]);
      return stdout.trim() === 'healthy';
    } catch {
      return false;
    }
  }

  async getVersion(): Promise<string> {
    try {
      const { stdout } = await execa('docker', [
        'inspect',
        '--format', '{{.Config.Image}}',
        this.containerName
      ]);
      return stdout.trim();
    } catch {
      return 'unknown';
    }
  }

  private async isRunning(): Promise<boolean> {
    try {
      const { stdout } = await execa('docker', [
        'ps',
        '--filter', `name=${this.containerName}`,
        '--filter', 'status=running',
        '--format', '{{.Names}}'
      ]);
      return stdout.trim() === this.containerName;
    } catch {
      return false;
    }
  }

  private async containerExists(): Promise<boolean> {
    try {
      const { stdout } = await execa('docker', [
        'ps',
        '-a',
        '--filter', `name=${this.containerName}`,
        '--format', '{{.Names}}'
      ]);
      return stdout.trim() === this.containerName;
    } catch {
      return false;
    }
  }
}
