import { execa } from './exec.js';


export class PostgresService {
  private containerName = 'eve-brain-postgres';
  private image = 'postgres:16-alpine';

  async install(): Promise<void> {
    console.log('Installing PostgreSQL...');
    
    await execa('docker', ['pull', this.image], { stdio: 'inherit' });
    
    console.log('PostgreSQL image pulled successfully');
  }

  async start(): Promise<void> {
    const running = await this.isRunning();
    if (running) {
      console.log('PostgreSQL is already running');
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
        '-p', '5432:5432',
        '-e', 'POSTGRES_USER=eve',
        '-e', 'POSTGRES_PASSWORD=eve',
        '-e', 'POSTGRES_DB=synap',
        '-v', 'eve-postgres-data:/var/lib/postgresql/data',
        '--restart', 'unless-stopped',
        this.image
      ], { stdio: 'inherit' });
    }

    console.log('PostgreSQL started on port 5432');
    
    // Wait for PostgreSQL to be ready
    await this.waitForReady();
  }

  async stop(): Promise<void> {
    console.log('Stopping PostgreSQL...');
    
    const running = await this.isRunning();
    if (!running) {
      console.log('PostgreSQL is not running');
      return;
    }

    await execa('docker', ['stop', this.containerName], { stdio: 'inherit' });
    console.log('PostgreSQL stopped');
  }

  async createDatabase(name: string): Promise<void> {
    console.log(`Creating database: ${name}...`);
    
    await execa('docker', [
      'exec',
      this.containerName,
      'psql',
      '-U', 'eve',
      '-c',
      `CREATE DATABASE ${name};`
    ], { stdio: 'inherit' });
    
    console.log(`Database ${name} created`);
  }

  async isHealthy(): Promise<boolean> {
    try {
      await execa('docker', [
        'exec',
        this.containerName,
        'pg_isready',
        '-U', 'eve'
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
    console.log('Waiting for PostgreSQL to be ready...');
    
    let attempts = 0;
    const maxAttempts = 30;
    
    while (attempts < maxAttempts) {
      if (await this.isHealthy()) {
        console.log('PostgreSQL is ready');
        return;
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;
    }
    
    throw new Error('PostgreSQL failed to become ready');
  }
}
