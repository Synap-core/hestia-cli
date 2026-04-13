import { execa } from 'execa';
import { logger } from '@hestia/dna';

export class RedisService {
  private containerName = 'hestia-redis';
  private image = 'redis:7-alpine';

  async install(): Promise<void> {
    logger.info('Installing Redis...');
    
    await execa('docker', ['pull', this.image], { stdio: 'inherit' });
    
    logger.success('Redis image pulled successfully');
  }

  async start(): Promise<void> {
    const running = await this.isRunning();
    if (running) {
      logger.info('Redis is already running');
      return;
    }

    const exists = await this.containerExists();
    if (exists) {
      await execa('docker', ['start', this.containerName], { stdio: 'inherit' });
    } else {
      await execa('docker', [
        'run',
        '-d',
        '--name', this.containerName,
        '--network', 'hestia-network',
        '-p', '6379:6379',
        '-v', 'hestia-redis-data:/data',
        '--restart', 'unless-stopped',
        this.image,
        'redis-server',
        '--appendonly', 'yes'
      ], { stdio: 'inherit' });
    }

    logger.success('Redis started on port 6379');
    
    // Wait for Redis to be ready
    await this.waitForReady();
  }

  async stop(): Promise<void> {
    logger.info('Stopping Redis...');
    
    const running = await this.isRunning();
    if (!running) {
      logger.info('Redis is not running');
      return;
    }

    await execa('docker', ['stop', this.containerName], { stdio: 'inherit' });
    logger.success('Redis stopped');
  }

  async isHealthy(): Promise<boolean> {
    try {
      await execa('docker', [
        'exec',
        this.containerName,
        'redis-cli',
        'ping'
      ]);
      return true;
    } catch {
      return false;
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

  private async waitForReady(): Promise<void> {
    logger.info('Waiting for Redis to be ready...');
    
    let attempts = 0;
    const maxAttempts = 30;
    
    while (attempts < maxAttempts) {
      if (await this.isHealthy()) {
        logger.success('Redis is ready');
        return;
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;
    }
    
    throw new Error('Redis failed to become ready');
  }
}
