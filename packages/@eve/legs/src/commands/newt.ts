import type { Command } from 'commander';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const COMPOSE = `services:
  newt:
    image: fosrl/newt:latest
    container_name: eve-legs-newt
    restart: unless-stopped
    env_file:
      - \${NEWT_ENV_FILE}
    networks:
      - eve-network

networks:
  eve-network:
    external: true
`.trim();

function composePath(cwd: string): string {
  return join(cwd, '.eve', 'legs', 'newt-compose.yml');
}

function envPath(cwd: string): string {
  return join(cwd, '.eve', 'legs', 'newt.env');
}

/** Write template env file (user fills NEWT_* from Pangolin dashboard). */
export function writeNewtEnvTemplate(cwd: string): string {
  const dir = join(cwd, '.eve', 'legs');
  mkdirSync(dir, { recursive: true });
  const p = envPath(cwd);
  if (!existsSync(p)) {
    writeFileSync(
      p,
      [
        '# Pangolin Newt site connector — https://docs.pangolin.net/manage/sites/install-site',
        'PANGOLIN_ENDPOINT=https://your-pangolin-host.example',
        'NEWT_ID=',
        'NEWT_SECRET=',
        'LOG_LEVEL=INFO',
        '# Optional: Docker discovery (read-only socket)',
        '# DOCKER_SOCKET=unix:///var/run/docker.sock',
        '',
      ].join('\n'),
      'utf-8',
    );
  }
  return p;
}

export function newtCommand(program: Command): void {
  const n = program.command('newt').description('Pangolin Newt (site connector) on eve-network — fosrl/newt');

  n.command('init')
    .description('Write .eve/legs/newt.env template if missing')
    .action(() => {
      const cwd = process.cwd();
      const p = writeNewtEnvTemplate(cwd);
      console.log(`Newt env template: ${p}\nEdit PANGOLIN_ENDPOINT, NEWT_ID, NEWT_SECRET then run: eve legs newt up`);
    });

  n.command('up')
    .description('Start Newt container (requires filled newt.env + eve-network)')
    .action(() => {
      const cwd = process.cwd();
      writeNewtEnvTemplate(cwd);
      const envFile = envPath(cwd);
      mkdirSync(join(cwd, '.eve', 'legs'), { recursive: true });
      writeFileSync(composePath(cwd), COMPOSE, 'utf-8');
      try {
        execSync('docker network create eve-network', { stdio: 'ignore' });
      } catch {
        /* exists */
      }
      const env = { ...process.env, NEWT_ENV_FILE: envFile };
      execSync(`docker compose -f "${composePath(cwd)}" up -d`, { stdio: 'inherit', cwd, env });
      console.log('\nNewt running. See Pangolin dashboard for site status.\n');
    });

  n.command('down')
    .description('Stop Newt container')
    .action(() => {
      const cwd = process.cwd();
      if (!existsSync(composePath(cwd))) {
        console.log('No newt compose. Run: eve legs newt up');
        return;
      }
      execSync(`docker compose -f "${composePath(cwd)}" down`, { stdio: 'inherit', cwd, env: { ...process.env, NEWT_ENV_FILE: envPath(cwd) } });
    });
}
