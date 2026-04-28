import { execSync, spawnSync } from 'node:child_process';
import { execa } from './exec.js';
import { resolveSynapDelegate } from './synap-delegate.js';

export interface SynapHealth {
  status: 'healthy' | 'unhealthy' | 'starting';
  version?: string;
  uptime?: number;
}

/** Returns all container IDs in the synap-backend compose project (running + stopped). */
function getSynapContainerIds(runningOnly = false): string[] {
  try {
    const flag = runningOnly ? '' : '-a';
    const out = execSync(
      `docker ps ${flag} --filter "label=com.docker.compose.project=synap-backend" --format "{{.Names}}"`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] },
    ).trim();
    return out.split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

export class SynapService {
  private delegate() {
    return resolveSynapDelegate();
  }

  private requireDelegate() {
    const d = this.delegate();
    if (!d) {
      throw new Error(
        'Synap repo not found. Pass --synap-repo <path> or set SYNAP_REPO_ROOT to a synap-backend checkout.\n' +
        'Tried: SYNAP_REPO_ROOT env, saved state, /opt/synap, /opt/synap-backend.',
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

    // Fallback: start existing containers via Docker directly
    const containers = getSynapContainerIds();
    if (containers.length === 0) {
      throw new Error(
        'No synap-backend containers found and no synap repo configured.\n' +
        'Run: npx eve brain init --synap-repo <path-to-synap-backend>',
      );
    }
    console.log(`Starting ${containers.length} synap-backend container(s) directly...`);
    for (const name of containers) {
      const result = spawnSync('docker', ['start', name], { stdio: 'inherit' });
      if (result.status !== 0) {
        throw new Error(`Failed to start container: ${name}`);
      }
    }
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

    // Fallback: stop running containers via Docker directly
    const containers = getSynapContainerIds(true);
    if (containers.length === 0) {
      console.log('No running synap-backend containers found.');
      return;
    }
    console.log(`Stopping ${containers.length} synap-backend container(s) directly...`);
    for (const name of containers) {
      spawnSync('docker', ['stop', name], { stdio: 'inherit' });
    }
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
