import { execSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

const GATEWAY_CONTAINER = 'eve-inference-gateway';
const DEFAULT_HOST_PORT = '11435';

export interface InferenceGatewayResult {
  baseDir: string;
  hostPort: string;
  publicUrl: string;
  username: string;
  password: string;
  secretsFile: string;
}

/**
 * Traefik file-provider gateway in front of Ollama on eve-network (Basic auth).
 * Binds host port 11435 by default so Synap Caddy can keep 80/443.
 */
export class InferenceGateway {
  private readonly baseDir: string;
  private readonly hostPort: string;

  constructor(cwd: string = process.cwd(), hostPort: string = DEFAULT_HOST_PORT) {
    this.baseDir = join(cwd, '.eve', 'inference-gateway');
    this.hostPort = process.env.EVE_INFERENCE_GATEWAY_PORT?.trim() || hostPort;
  }

  /** APR1 hash line for Traefik usersFile (user:hash). */
  private htpasswdLine(username: string, plainPassword: string): string {
    const r = spawnSync('openssl', ['passwd', '-apr1', plainPassword], { encoding: 'utf-8' });
    if (r.error || r.status !== 0) {
      throw new Error(`openssl passwd -apr1 failed: ${r.stderr || r.error?.message || 'unknown'}`);
    }
    const hash = (r.stdout ?? '').trim();
    return `${username}:${hash}`;
  }

  async ensure(ollamaHost: string = 'http://eve-brain-ollama:11434'): Promise<InferenceGatewayResult> {
    mkdirSync(join(this.baseDir, 'dynamic'), { recursive: true });

    const username = 'eve';
    const password = randomBytes(18).toString('base64url').slice(0, 24);
    const userLine = this.htpasswdLine(username, password);

    const staticYaml = `
entryPoints:
  web:
    address: ":80"

providers:
  file:
    directory: /etc/traefik/dynamic
    watch: true

log:
  level: INFO
`.trim();

    writeFileSync(join(this.baseDir, 'dynamic', 'ollama-users'), `${userLine}\n`, { mode: 0o600 });

    const dynamicYaml = [
      'http:',
      '  routers:',
      '    ollama_api:',
      '      rule: PathPrefix(`/`)',
      '      entryPoints:',
      '        - web',
      '      service: ollama_svc',
      '      middlewares:',
      '        - ollama_auth',
      '  middlewares:',
      '    ollama_auth:',
      '      basicAuth:',
      '        usersFile: /etc/traefik/dynamic/ollama-users',
      '  services:',
      '    ollama_svc:',
      '      loadBalancer:',
      '        servers:',
      `          - url: "${ollamaHost}"`,
    ].join('\n');

    writeFileSync(join(this.baseDir, 'traefik.yml'), staticYaml);
    writeFileSync(join(this.baseDir, 'dynamic', 'ollama.yml'), dynamicYaml);

    const secretsFile = join(this.baseDir, '..', 'secrets', 'ollama-gateway.txt');
    mkdirSync(join(this.baseDir, '..', 'secrets'), { recursive: true });
    const secretBody =
      `# Eve inference gateway (Basic auth for Ollama)\n` +
      `URL=http://127.0.0.1:${this.hostPort}\n` +
      `USER=${username}\n` +
      `PASS=${password}\n` +
      `\n` +
      `Example:\n` +
      `  curl -u '${username}:${password}' http://127.0.0.1:${this.hostPort}/api/tags\n`;
    writeFileSync(secretsFile, secretBody, { mode: 0o600 });

    try {
      execSync('docker network create eve-network', { stdio: 'ignore' });
    } catch {
      /* exists */
    }

    const running = this.isGatewayRunning();
    if (!running) {
      if (this.gatewayContainerExists()) {
        execSync(`docker start ${GATEWAY_CONTAINER}`, { stdio: 'inherit' });
      } else {
        execSync(
          [
            'docker',
            'run',
            '-d',
            '--name',
            GATEWAY_CONTAINER,
            '--restart',
            'unless-stopped',
            '--network',
            'eve-network',
            '-p',
            `${this.hostPort}:80`,
            '-v',
            `${this.baseDir}/traefik.yml:/etc/traefik/traefik.yml:ro`,
            '-v',
            `${this.baseDir}/dynamic:/etc/traefik/dynamic:ro`,
            'traefik:v3.0',
            '--configFile=/etc/traefik/traefik.yml',
          ].join(' '),
          { stdio: 'inherit' },
        );
      }
    }

    return {
      baseDir: this.baseDir,
      hostPort: this.hostPort,
      publicUrl: `http://127.0.0.1:${this.hostPort}`,
      username,
      password,
      secretsFile,
    };
  }

  private gatewayContainerExists(): boolean {
    try {
      execSync(`docker container inspect ${GATEWAY_CONTAINER}`, { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  private isGatewayRunning(): boolean {
    try {
      const out = execSync(`docker inspect -f '{{.State.Running}}' ${GATEWAY_CONTAINER}`, {
        encoding: 'utf-8',
      }).trim();
      return out === 'true';
    } catch {
      return false;
    }
  }
}
