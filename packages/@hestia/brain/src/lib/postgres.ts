import { execa } from 'execa';
import { logger } from '@hestia/dna';

export class PostgresService {
  private containerName = 'hestia-postgres';
  private image = 'postgres:16-alpine';

  async install(): Promise<void> {
    logger.info('Installing PostgreSQL...');
    
    await execa('docker', ['pull', this.image], { stdio: 'inherit' });
    
    logger.success('PostgreSQL image pulled successfully');
  }

  async start(): Promise<void> {
    const running = await this.isRunning();
    if (running) {
      logger.info('PostgreSQL is already running');
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
        '-p', '5432:5432',
        '-e', 'POSTGRES_USER=hestia',
        '-e', 'POSTGRES_PASSWORD=hestia',
        '-e', 'POSTGRES_DB=synap',
        '-v', 'hestia-postgres-data:/var/lib/postgresql/data',
        '--restart', 'unless-stopped',
        this.image
      ], { stdio: 'inherit' });
    }

    logger.success('PostgreSQL started on port 5432');
    
    // Wait for PostgreSQL to be ready
    await this.waitForReady();
  }

  async stop(): Promise<void> {
    logger.info('Stopping PostgreSQL...');
    
    const running = await this.isRunning();
    if (!running) {
      logger.info('PostgreSQL is not running');
      return;
    }

    await execa('docker', ['stop', this.containerName], { stdio: 'inherit' });
    logger.success('PostgreSQL stopped');
  }

  async createDatabase(name: string): Promise<void> {
    logger.info(`Creating database: ${name}...`);
    
    await execa('docker', [
      'exec',
      this.containerName,
      'psql',
      '-U', 'hestia',
      '-c',
      `CREATE DATABASE ${name};`
    ], { stdio: 'inherit' });
    
    logger.success(`Database ${name} created`);
  }

  async isHealthy(): Promise<boolean> {
    try {
      await execa('docker', [
        'exec',
        this.containerName,
        'pg_isready',
        '-U', 'hestia'
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
    logger.info('Waiting for PostgreSQL to be ready...');
    
    let attempts = 0;
    const maxAttempts = 30;
    
    while (attempts < maxAttempts) {
      if (await this.isHealthy()) {
        logger.success('PostgreSQL is ready');
        return;
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;
    }
    
    throw new Error('PostgreSQL failed to become ready');
  }
}
