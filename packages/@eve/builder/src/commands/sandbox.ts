import type { Command } from 'commander';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { writeSandboxEnvFile } from '@eve/dna';

const COMPOSE = `services:
  eve-builder-sandbox:
    image: node:22-bookworm-slim
    container_name: eve-builder-sandbox
    restart: unless-stopped
    working_dir: /workspace
    env_file:
      - \${EVE_SANDBOX_ENV_FILE}
    volumes:
      - \${EVE_WORKSPACE_DIR}:/workspace:rw
    command: ["bash", "-lc", "echo 'Eve builder sandbox ready. Example: docker exec -it eve-builder-sandbox bash' && tail -f /dev/null"]
    networks:
      - eve-network

networks:
  eve-network:
    external: true
`.trim();

function composePath(cwd: string): string {
  return join(cwd, '.eve', 'builder-sandbox-compose.yml');
}

export function sandboxCommand(program: Command): void {
  const sb = program.command('sandbox').description('OpenCode-friendly Node sandbox (workspace RW only, eve-network)');

  sb.command('prepare')
    .description('Write .eve/sandbox.env from secrets (no container start)')
    .action(async () => {
      const cwd = process.cwd();
      const p = await writeSandboxEnvFile(cwd);
      console.log(`Wrote ${p}`);
    });

  sb.command('up')
    .description('Start sandbox container (requires docker, eve-network)')
    .action(async () => {
      const cwd = process.cwd();
      const envFile = await writeSandboxEnvFile(cwd);
      mkdirSync(join(cwd, '.eve'), { recursive: true });
      writeFileSync(composePath(cwd), COMPOSE, 'utf-8');
      try {
        execSync('docker network create eve-network', { stdio: 'ignore' });
      } catch {
        /* exists */
      }
      const env = {
        ...process.env,
        EVE_SANDBOX_ENV_FILE: envFile,
      };
      execSync(`docker compose -f "${composePath(cwd)}" up -d`, {
        stdio: 'inherit',
        cwd,
        env,
      });
      console.log('\nSandbox: docker exec -it eve-builder-sandbox bash');
      console.log('Then: npx @opencode/cli … (install as needed). Env is in container from sandbox.env\n');
    });

  sb.command('down')
    .description('Stop sandbox container')
    .action(() => {
      const cwd = process.cwd();
      if (!existsSync(composePath(cwd))) {
        console.log('No sandbox compose. Run: eve builder sandbox up');
        return;
      }
      execSync(`docker compose -f "${composePath(cwd)}" down`, { stdio: 'inherit', cwd });
    });

  sb.command('status')
    .description('Show sandbox container status')
    .action(() => {
      try {
        execSync(
          'docker ps -a --filter name=eve-builder-sandbox --format "table {{.Names}}\\t{{.Status}}\\t{{.Ports}}"',
          { stdio: 'inherit' },
        );
      } catch {
        console.log('No eve-builder-sandbox container');
      }
    });
}
