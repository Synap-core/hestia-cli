import { execa } from './exec.js';


export class RedisService {
  private containerName = 'eve-brain-redis';
  private image = 'redis:7-alpine';

  async install(): Promise<void> {
    console.log('Installing Redis...');
    
    await execa('docker', ['pull', this.image], { stdio: 'inherit' });
    
    console.log('Redis image pulled successfully');
  }

  async start(): Promise<void> {
    const running = await this.isRunning();
    if (running) {
      console.log('Redis is already running');
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
        '--network', 'eve-network',
        '-p', '6379:6379',
        '-v', 'eve-redis-data:/data',
        '--restart', 'unless-stopped',
        this.image,
        'redis-server',
        '--appendonly', 'yes'
      ], { stdio: 'inherit' });
    }

    console.log('Redis started on port 6379');
    
    // Wait for Redis to be ready
    await this.waitForReady();
  }

  async stop(): Promise<void> {
    console.log('Stopping Redis...');
    
    const running = await this.isRunning();
    if (!running) {
      console.log('Redis is not running');
      return;
    }

    await execa('docker', ['stop', this.containerName], { stdio: 'inherit' });
    console.log('Redis stopped');
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
    console.log('Waiting for Redis to be ready...');
    
    let attempts = 0;
    const maxAttempts = 30;
    
    while (attempts < maxAttempts) {
      if (await this.isHealthy()) {
        console.log('Redis is ready');
        return;
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;
    }
    
    throw new Error('Redis failed to become ready');
  }
}
