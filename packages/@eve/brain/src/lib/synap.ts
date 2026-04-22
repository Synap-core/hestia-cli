import { execa } from './exec.js';
import { resolveSynapDelegate } from './synap-delegate.js';

export interface SynapHealth {
  status: 'healthy' | 'unhealthy' | 'starting';
  version?: string;
  uptime?: number;
}

export class SynapService {
  private delegate() {
    return resolveSynapDelegate();
  }

  private requireDelegate() {
    const d = this.delegate();
    if (!d) {
      throw new Error(
        'Synap delegate not configured. Set SYNAP_REPO_ROOT to a valid synap-backend checkout (must contain `synap` and `deploy/docker-compose.yml`), then run `eve setup --profile data_pod --synap-repo <path>`.',
      );
    }
    return d;
  }

  async install(): Promise<void> {
    this.requireDelegate();
    console.log(
      'Synap install is managed via the official synap CLI. Use `eve brain init --synap-repo <path>` or `eve setup --profile data_pod`.',
    );
  }

  async start(): Promise<void> {
    const d = this.requireDelegate();
    console.log('Starting Synap stack via synap CLI...');
    await execa('bash', [d.synapScript, 'start'], {
      cwd: d.repoRoot,
      env: { ...process.env, SYNAP_DEPLOY_DIR: d.deployDir },
      stdio: 'inherit',
    });
  }

  async stop(): Promise<void> {
    const d = this.requireDelegate();
    console.log('Stopping Synap stack via synap CLI...');
    await execa('bash', [d.synapScript, 'stop'], {
      cwd: d.repoRoot,
      env: { ...process.env, SYNAP_DEPLOY_DIR: d.deployDir },
      stdio: 'inherit',
    });
  }

  async isHealthy(): Promise<boolean> {
    this.requireDelegate();
    try {
      const res = await fetch('http://127.0.0.1:4000/health', { signal: AbortSignal.timeout(3000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  async getVersion(): Promise<string> {
    this.requireDelegate();
    return 'synap-compose';
  }
}
