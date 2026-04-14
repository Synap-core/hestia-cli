import type { Command } from 'commander';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

function parsePostgresUrl(url: string): {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl: boolean;
} | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'postgres:' && u.protocol !== 'postgresql:') return null;
    const database = u.pathname.replace(/^\//, '').split('/')[0] ?? '';
    return {
      host: u.hostname,
      port: u.port ? Number(u.port) : 5432,
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database,
      ssl: u.searchParams.get('sslmode') === 'require' || u.searchParams.get('ssl') === 'true',
    };
  } catch {
    return null;
  }
}

function eyesDir(cwd: string): string {
  return join(cwd, '.eve', 'eyes');
}

export function databaseCommand(program: Command): void {
  const db = program
    .command('database')
    .description('Outerbase Studio (npm CLI) for Postgres — see https://www.npmjs.com/package/@outerbase/studio');

  db.command('init')
    .description('Write outerbase.json template (Postgres via DATABASE_URL)')
    .requiredOption('--database-url <url>', 'postgres://user:pass@host:5432/dbname')
    .option('--port <n>', 'Studio listen port', '4000')
    .option('--user <u>', 'HTTP Basic auth user for Studio UI')
    .option('--pass <p>', 'HTTP Basic auth password for Studio UI')
    .action((opts: { databaseUrl: string; port?: string; user?: string; pass?: string }) => {
      const cwd = process.cwd();
      const parsed = parsePostgresUrl(opts.databaseUrl);
      if (!parsed) {
        console.error('Invalid --database-url (expected postgres://...)');
        process.exit(1);
      }
      const dir = eyesDir(cwd);
      mkdirSync(dir, { recursive: true });
      const config = {
        driver: 'postgres',
        port: Number(opts.port) || 4000,
        connection: {
          database: parsed.database,
          host: parsed.host,
          port: parsed.port,
          user: parsed.user,
          password: parsed.password,
          ssl: parsed.ssl,
        },
        ...(opts.user && opts.pass
          ? { auth: { username: opts.user, password: opts.pass } }
          : {}),
      };
      const path = join(dir, 'outerbase.json');
      writeFileSync(path, JSON.stringify(config, null, 2), 'utf-8');
      console.log(`Wrote ${path}`);
      console.log(
        'Note: @outerbase/studio embeds UI from studio.outerbase.com — offline/air-gapped hosts cannot render the UI.',
      );
    });

  const COMPOSE = `services:
  outerbase-studio:
    image: node:22-bookworm-slim
    container_name: eve-eyes-outerbase
    restart: unless-stopped
    working_dir: /config
    volumes:
      - ./outerbase.json:/config/outerbase.json:ro
    ports:
      - "127.0.0.1:\${OUTERBASE_HOST_PORT}:4000"
    command: ["bash", "-lc", "npm install -g @outerbase/studio@0.2.7 && exec studio --config=/config/outerbase.json --port=4000"]
    networks:
      - eve-network

networks:
  eve-network:
    external: true
`.trim();

  db.command('up')
    .description('docker compose up Outerbase Studio (run database init first)')
    .option('--port <n>', 'Host port to bind', '4005')
    .action((opts: { port?: string }) => {
      const cwd = process.cwd();
      const dir = eyesDir(cwd);
      const cfg = join(dir, 'outerbase.json');
      if (!existsSync(cfg)) {
        console.error('Missing outerbase.json. Run: eve eyes database init --database-url ...');
        process.exit(1);
      }
      const composeFile = join(dir, 'outerbase-compose.yml');
      mkdirSync(dir, { recursive: true });
      writeFileSync(composeFile, COMPOSE, 'utf-8');
      try {
        execSync('docker network create eve-network', { stdio: 'ignore' });
      } catch {
        /* exists */
      }
      const env = {
        ...process.env,
        OUTERBASE_HOST_PORT: opts.port ?? '4005',
      };
      execSync(`docker compose -f "${composeFile}" up -d`, {
        stdio: 'inherit',
        cwd: dir,
        env,
      });
      console.log(`\nOuterbase Studio: http://127.0.0.1:${opts.port ?? '4005'}\n`);
    });

  db.command('down')
    .description('Stop Outerbase Studio container')
    .action(() => {
      const cwd = process.cwd();
      const dir = eyesDir(cwd);
      const composeFile = join(dir, 'outerbase-compose.yml');
      if (!existsSync(composeFile)) {
        console.log('No compose file');
        return;
      }
      execSync(`docker compose -f "${composeFile}" down`, { stdio: 'inherit', cwd: dir });
    });
}
