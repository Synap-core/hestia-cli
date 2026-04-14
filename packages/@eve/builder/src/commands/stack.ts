import type { Command } from 'commander';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const COMPOSE = `services:
  eve-builder-site:
    image: nginx:alpine
    container_name: eve-builder-site
    restart: unless-stopped
    ports:
      - "127.0.0.1:9080:80"
    volumes:
      - \${EVE_BUILDER_SITE_DIR}:/usr/share/nginx/html:ro
    networks:
      - eve-network

networks:
  eve-network:
    external: true
`.trim();

function composePath(cwd: string): string {
  return join(cwd, '.eve', 'builder-docker-compose.yml');
}

function defaultSiteDir(cwd: string): string {
  return join(cwd, '.eve', 'builder-site', 'public');
}

function ensureSiteContent(siteDir: string): void {
  mkdirSync(siteDir, { recursive: true });
  const index = join(siteDir, 'index.html');
  if (!existsSync(index)) {
    writeFileSync(
      index,
      `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><title>Eve Builder</title></head><body><h1>Builder base site</h1><p>Static root for OpenCode output. Served at http://127.0.0.1:9080</p></body></html>\n`,
    );
  }
}

export function stackCommand(program: Command): void {
  const stack = program.command('stack').description('Nginx base site stack (Docker, eve-network, :9080)');

  stack
    .command('up')
    .description('Start nginx static site container')
    .action(() => {
      const cwd = process.cwd();
      const siteDir = defaultSiteDir(cwd);
      ensureSiteContent(siteDir);
      mkdirSync(join(cwd, '.eve'), { recursive: true });
      writeFileSync(composePath(cwd), COMPOSE, 'utf-8');
      try {
        execSync('docker network create eve-network', { stdio: 'ignore' });
      } catch {
        /* exists */
      }
      const env = { ...process.env, EVE_BUILDER_SITE_DIR: siteDir };
      execSync(`docker compose -f "${composePath(cwd)}" up -d`, {
        stdio: 'inherit',
        cwd,
        env,
      });
      console.log(`\nBuilder site: http://127.0.0.1:9080  (files under ${siteDir})`);
    });

  stack
    .command('down')
    .description('Stop nginx static site container')
    .action(() => {
      const cwd = process.cwd();
      const siteDir = defaultSiteDir(cwd);
      const env = { ...process.env, EVE_BUILDER_SITE_DIR: siteDir };
      if (!existsSync(composePath(cwd))) {
        console.log('No generated compose file. Run: eve builder stack up');
        return;
      }
      execSync(`docker compose -f "${composePath(cwd)}" down`, {
        stdio: 'inherit',
        cwd,
        env,
      });
    });

  stack
    .command('status')
    .description('Show builder stack container status')
    .action(() => {
      try {
        execSync(
          'docker ps -a --filter name=eve-builder-site --format "table {{.Names}}\\t{{.Status}}\\t{{.Ports}}"',
          { stdio: 'inherit' },
        );
      } catch {
        console.log('No eve-builder-site container (run: eve builder stack up)');
      }
    });
}
