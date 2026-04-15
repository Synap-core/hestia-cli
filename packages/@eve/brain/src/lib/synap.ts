import { execa } from './exec.js';
import { resolveSynapDelegate } from './synap-delegate.js';

export interface SynapHealth {
  status: 'healthy' | 'unhealthy' | 'starting';
  version?: string;
  uptime?: number;
}

export class SynapService {
  private containerName = 'eve-brain-synap';
  private image = 'ghcr.io/synap-core/backend:latest';

  private delegate() {
    return resolveSynapDelegate();
  }

  async install(): Promise<void> {
    const d = this.delegate();
    if (d) {
      console.log('Synap Data Pod: using synap CLI (SYNAP_REPO_ROOT). Run install via eve brain init --synap-repo …');
      return;
    }

    console.log('Installing Synap backend...');

    await execa('docker', ['pull', this.image], { stdio: 'inherit' });

    console.log('Synap backend image pulled successfully');
  }

  async start(): Promise<void> {
    const d = this.delegate();
    if (d) {
      console.log('Starting Synap stack via synap CLI...');
      await execa('bash', [d.synapScript, 'start'], {
        cwd: d.repoRoot,
        env: { ...process.env, SYNAP_DEPLOY_DIR: d.deployDir },
        stdio: 'inherit',
      });
      return;
    }

    console.log('Starting Synap backend...');

    const running = await this.isRunning();
    if (running) {
      console.log('Synap backend is already running');
      return;
    }

    const exists = await this.containerExists();
    if (exists) {
      await execa('docker', ['start', this.containerName], { stdio: 'inherit' });
    } else {
      await execa(
        'docker',
        [
          'run',
          '-d',
          '--name',
          this.containerName,
          '--network',
          'eve-network',
          '-p',
          '4000:4000',
          '-e',
          'NODE_ENV=production',
          '-e',
          'DATABASE_URL=postgresql://eve:eve@eve-brain-postgres:5432/synap',
          '-e',
          'REDIS_URL=redis://eve-brain-redis:6379',
          '-e',
          'JWT_SECRET=hestia-local-dev-secret',
          '--restart',
          'unless-stopped',
          this.image,
        ],
        { stdio: 'inherit' },
      );
    }

    console.log('Synap backend started on port 4000');
  }

  async stop(): Promise<void> {
    const d = this.delegate();
    if (d) {
      console.log('Stopping Synap stack via synap CLI...');
      await execa('bash', [d.synapScript, 'stop'], {
        cwd: d.repoRoot,
        env: { ...process.env, SYNAP_DEPLOY_DIR: d.deployDir },
        stdio: 'inherit',
      });
      return;
    }

    console.log('Stopping Synap backend...');

    const running = await this.isRunning();
    if (!running) {
      console.log('Synap backend is not running');
      return;
    }

    await execa('docker', ['stop', this.containerName], { stdio: 'inherit' });
    console.log('Synap backend stopped');
  }

  async isHealthy(): Promise<boolean> {
    if (this.delegate()) {
      try {
        const res = await fetch('http://127.0.0.1:4000/health', { signal: AbortSignal.timeout(3000) });
        return res.ok;
      } catch {
        return false;
      }
    }

    try {
      const { stdout } = await execa('docker', [
        'inspect',
        '--format',
        '{{.State.Health.Status}}',
        this.containerName,
      ]);
      return stdout.trim() === 'healthy';
    } catch {
      return false;
    }
  }

  async getVersion(): Promise<string> {
    if (this.delegate()) {
      return 'synap-compose';
    }

    try {
      const { stdout } = await execa('docker', [
        'inspect',
        '--format',
        '{{.Config.Image}}',
        this.containerName,
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
        '--filter',
        `name=${this.containerName}`,
        '--filter',
        'status=running',
        '--format',
        '{{.Names}}',
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
        '--filter',
        `name=${this.containerName}`,
        '--format',
        '{{.Names}}',
      ]);
      return stdout.trim() === this.containerName;
    } catch {
      return false;
    }
  }
}
