/**
 * `eve synap` — Manage Synap staging on CT101 (PM2 + Traefik).
 *
 * Usage:
 *   eve synap deploy                    # sync + build all + PM2 start + routes
 *   eve synap deploy --app crm          # build + deploy single app
 *   eve synap deploy --no-build         # PM2 reload + routes only
 *   eve synap status                    # PM2 + Docker + routes overview
 *   eve synap logs <app>                # tail PM2 logs
 *   eve synap build                     # build all apps
 *   eve synap build crm devplane        # build specific apps
 */

import type { Command } from 'commander';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readEveSecrets } from '@eve/dna';
import { TraefikService } from '@eve/legs';
import { colors, printSuccess, printInfo, printWarning, printError, printHeader } from '../lib/ui.js';

const SYNAP_DIR = '/opt/synap/synap-app';
const PM2_APPS = [
  { name: 'hub', port: 3120 },
  { name: 'canvas', port: 3124 },
  { name: 'base', port: 3126 },
  { name: 'web', port: 3128 },
  { name: 'studio', port: 3130 },
  { name: 'devplane', port: 3132 },
  { name: 'crm', port: 3134 },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function run(cmd: string, cwd?: string): string {
  try {
    return execSync(cmd, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'inherit'] });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Command failed: ${cmd}\n${msg}`);
  }
}

function runSilent(cmd: string, cwd?: string): string {
  return execSync(cmd, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
}

function pm2Cmd(args: string): string {
  return runSilent(`pm2 ${args}`).trim();
}

function appDir(name: string): string {
  return join(SYNAP_DIR, 'apps', name);
}

function hasPackageJson(dir: string): boolean {
  return existsSync(join(dir, 'package.json'));
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export function synapCommand(program: Command): void {
  const synap = program
    .command('synap')
    .description('Manage Synap staging on CT101 (PM2 + Traefik)');

  // ─── deploy ──────────────────────────────────────────────────────────────
  synap
    .command('deploy')
    .description('Build and deploy Synap apps to staging')
    .option('--app <name>', 'Deploy a single app')
    .option('--no-build', 'Skip build, only restart PM2 + apply routes')
    .option('--clean', 'Clean .next before build')
    .action(async (opts: { app?: string; build?: boolean; clean?: boolean }) => {
      printHeader('eve synap deploy');
      console.log();

      if (!existsSync(SYNAP_DIR)) {
        printError(`Synap app directory not found: ${SYNAP_DIR}`);
        printInfo('Run sync first: ./scripts/sync-to-ct101.sh');
        process.exit(1);
      }

      // Step 1: Git pull
      printInfo('Syncing code...');
      try {
        run('git pull --rebase', SYNAP_DIR);
        printSuccess('Code synced');
      } catch {
        printWarning('Git pull failed (may be uncommitted changes) — continuing');
      }

      // Step 2: Build
      if (opts.build !== false) {
        console.log();
        if (opts.app) {
          await buildApp(opts.app, opts.clean);
        } else {
          await buildAll(opts.clean);
        }
      }

      // Step 3: Start/restart PM2
      console.log();
      printInfo('Starting PM2 apps...');
      if (opts.app) {
        startPm2App(opts.app);
      } else {
        startAllPm2Apps();
      }

      // Step 4: Apply Traefik routes
      console.log();
      printInfo('Applying Traefik routes...');
      await applyRoutes();

      console.log();
      printSuccess('Deploy complete');
      printStagingUrls();
    });

  // ─── build ───────────────────────────────────────────────────────────────
  synap
    .command('build')
    .description('Build Synap apps')
    .argument('[apps...]', 'App names to build (default: all)')
    .option('--clean', 'Clean .next before build')
    .action(async (apps: string[], opts: { clean?: boolean }) => {
      printHeader('eve synap build');
      console.log();

      if (apps.length === 0) {
        await buildAll(opts.clean);
      } else {
        for (const app of apps) {
          await buildApp(app, opts.clean);
        }
      }

      console.log();
      printSuccess('Build complete');
    });

  // ─── status ──────────────────────────────────────────────────────────────
  synap
    .command('status')
    .alias('s')
    .description('Show Synap staging status')
    .action(async () => {
      printHeader('eve synap status');
      console.log();

      // PM2 status
      printInfo('PM2 Apps:');
      console.log(pm2Cmd('list'));

      // Docker services
      console.log();
      printInfo('Docker Services (synap-backend):');
      try {
        const out = runSilent('docker ps --filter "name=synap-backend" --format "table {{.Names}}\t{{.Status}}"');
        console.log(out);
      } catch {
        printWarning('No synap-backend containers found');
      }

      // Traefik routes
      console.log();
      printInfo('Traefik Routes:');
      try {
        const routes = runSilent('curl -s http://localhost:8080/api/http/routers');
        const names = JSON.parse(routes)
          .filter((r: any) => r.name.includes('custom') || r.name.includes('synap') || r.name.includes('pod'))
          .map((r: any) => `  ${r.name.padEnd(30)} ${r.rule || ''}`);
        console.log(names.join('\n'));
      } catch {
        printWarning('Could not fetch Traefik routes');
      }

      // Custom routes from Eve secrets
      console.log();
      printInfo('Custom Domain Routes:');
      try {
        const secrets = await readEveSecrets(process.cwd());
        const customRoutes = secrets?.domain?.customRoutes || [];
        if (customRoutes.length === 0) {
          printInfo('  No custom routes configured');
        } else {
          for (const route of customRoutes) {
            const domain = route.domain || secrets?.domain?.primary || 'unknown';
            console.log(`  ${route.subdomain}.${domain} → port ${route.port}`);
          }
        }
      } catch {
        printWarning('Could not read Eve secrets');
      }

      console.log();
    });

  // ─── logs ────────────────────────────────────────────────────────────────
  synap
    .command('logs')
    .description('View PM2 app logs')
    .argument('<app>', 'App name')
    .option('--lines <n>', 'Number of lines', '50')
    .option('--errors', 'Show only error logs')
    .action((app: string, opts: { lines?: string; errors?: boolean }) => {
      const lines = opts.lines || '50';
      if (opts.errors) {
        run(`pm2 logs ${app} --err --lines ${lines} --nostream`, SYNAP_DIR);
      } else {
        run(`pm2 logs ${app} --lines ${lines} --nostream`, SYNAP_DIR);
      }
    });

  // ─── restart ─────────────────────────────────────────────────────────────
  synap
    .command('restart')
    .description('Restart PM2 apps')
    .argument('[apps...]', 'App names to restart (default: all)')
    .option('--update-env', 'Update environment variables')
    .action((apps: string[], opts: { updateEnv?: boolean }) => {
      printHeader('eve synap restart');
      console.log();

      const flag = opts.updateEnv ? ' --update-env' : '';
      if (apps.length === 0) {
        printInfo('Restarting all PM2 apps...');
        pm2Cmd(`reload all${flag}`);
      } else {
        for (const app of apps) {
          printInfo(`Restarting ${app}...`);
          pm2Cmd(`restart ${app}${flag}`);
        }
      }

      printSuccess('Restarted');
    });
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

async function buildAll(clean?: boolean): Promise<void> {
  printInfo('Building all apps...');
  let success = 0;
  let failed = 0;

  for (const app of PM2_APPS) {
    const dir = appDir(app.name);
    if (!hasPackageJson(dir)) {
      printWarning(`Skipping ${app.name} — no package.json`);
      continue;
    }
    try {
      await buildApp(app.name, clean);
      success++;
    } catch {
      failed++;
    }
  }

  console.log();
  printInfo(`Build results: ${success} succeeded, ${failed} failed`);
  if (failed > 0) {
    printWarning('Some apps failed to build — check logs above');
  }
}

async function buildApp(name: string, clean?: boolean): Promise<void> {
  const dir = appDir(name);
  if (!hasPackageJson(dir)) {
    printError(`App "${name}" not found at ${dir}`);
    throw new Error(`App "${name}" not found`);
  }

  printInfo(`Building ${name}...`);

  if (clean) {
    const nextDir = join(dir, '.next');
    if (existsSync(nextDir)) {
      run(`rm -rf ${nextDir}`);
    }
  }

  try {
    run(`pnpm --filter ${name} build`, SYNAP_DIR);
    printSuccess(`${name} built successfully`);
  } catch (err) {
    printError(`${name} build failed`);
    throw err;
  }
}

function startPm2App(name: string): void {
  const dir = appDir(name);
  const appConfig = PM2_APPS.find(a => a.name === name);
  const port = appConfig?.port || 3000;

  // Check if already running
  try {
    const list = pm2Cmd('jlist');
    const apps = JSON.parse(list);
    const existing = apps.find((a: any) => a.name === name);
    if (existing) {
      pm2Cmd(`reload ${name}`);
      printSuccess(`${name} reloaded`);
      return;
    }
  } catch { /* pm2 not ready */ }

  // Start new
  const cmd = `pm2 start node --name ${name} -- node_modules/next/dist/bin/next start -p ${port}`;
  try {
    pm2Cmd(`delete ${name}`);
  } catch { /* not running */ }
  run(cmd, dir);
  printSuccess(`${name} started on port ${port}`);
}

function startAllPm2Apps(): void {
  for (const app of PM2_APPS) {
    const dir = appDir(app.name);
    if (!hasPackageJson(dir)) continue;
    try {
      startPm2App(app.name);
    } catch {
      printWarning(`Failed to start ${app.name}`);
    }
  }
  pm2Cmd('save');
}

async function applyRoutes(): Promise<void> {
  try {
    const traefik = new TraefikService();
    const secrets = await readEveSecrets(process.cwd());
    const domain = secrets?.domain?.primary;
    if (!domain) {
      printWarning('No primary domain configured — skipping Traefik route refresh');
      return;
    }

    await traefik.configureSubdomains(
      domain,
      secrets?.domain?.ssl !== false,
      secrets?.domain?.email,
      undefined,
      !!secrets?.domain?.behindProxy,
      secrets?.domain?.customRoutes,
    );
    printSuccess('Traefik routes updated');
  } catch (err) {
    printWarning(`Traefik route update failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function printStagingUrls(): void {
  console.log();
  printInfo('Staging URLs:');
  const secrets = readEveSecretsSync();
  const customRoutes = secrets?.domain?.customRoutes || [];
  const primaryDomain = secrets?.domain?.primary || 'perso.thearchitech.xyz';

  for (const route of customRoutes) {
    const domain = route.domain || primaryDomain;
    console.log(`  https://${route.subdomain}.${domain}`);
  }

  if (customRoutes.length === 0) {
    printInfo('  No custom routes configured. Add with: eve domain add <subdomain> --port <n>');
  }
}

function readEveSecretsSync() {
  try {
    const path = join(process.env.EVE_HOME || process.cwd(), '.eve', 'secrets', 'secrets.json');
    if (existsSync(path)) {
      return JSON.parse(readFileSync(path, 'utf-8'));
    }
  } catch { /* ignore */ }
  return null;
}
