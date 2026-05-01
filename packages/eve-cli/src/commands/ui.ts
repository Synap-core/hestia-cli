import type { Command } from 'commander';
import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa, execaSync } from 'execa';
import { readEveSecrets, writeEveSecrets } from '@eve/dna';
import { colors, emojis, createSpinner, printSuccess, printError, printInfo, printWarning } from '../lib/ui.js';

const __filename = fileURLToPath(import.meta.url);
// tsup bundles everything to dist/index.js — 3 levels up = packages/
const packagesDir = join(__filename, '..', '..', '..');

const SERVICE_NAME = 'eve-dashboard.service';
const SERVICE_PATH = `/etc/systemd/system/${SERVICE_NAME}`;

function dashboardDir(): string {
  return join(packagesDir, 'eve-dashboard');
}

/** True when systemd is the init system on this host. */
function hasSystemd(): boolean {
  try {
    execaSync('systemctl', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function buildSystemdUnit(port: number, secret: string, dir: string): string {
  return `[Unit]
Description=Eve Dashboard
After=network.target docker.service
Wants=docker.service

[Service]
Type=simple
WorkingDirectory=${dir}
Environment=PORT=${port}
Environment=EVE_DASHBOARD_SECRET=${secret}
Environment=PATH=/usr/local/bin:/usr/bin:/bin:/root/.local/share/pnpm
ExecStart=/usr/bin/env pnpm start --port ${port}
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
`;
}

async function installSystemdService(port: number): Promise<void> {
  if (process.platform !== 'linux') {
    printError('--install-service is Linux-only (requires systemd).');
    process.exit(1);
  }
  if (!hasSystemd()) {
    printError('systemctl not found. Is systemd available on this host?');
    process.exit(1);
  }
  if (process.getuid && process.getuid() !== 0) {
    printError('--install-service must be run as root (writes /etc/systemd/system/).');
    printInfo('Try: sudo eve ui --install-service');
    process.exit(1);
  }

  const dir = dashboardDir();

  // Ensure dashboard is built
  if (!existsSync(join(dir, '.next'))) {
    const spinner = createSpinner('Building dashboard before installing service...');
    spinner.start();
    try {
      await execa('pnpm', ['build'], { cwd: dir, env: { ...process.env } });
      spinner.succeed('Dashboard built');
    } catch (err) {
      spinner.fail('Dashboard build failed');
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  }

  // Ensure secret exists
  let secrets = await readEveSecrets(process.cwd());
  if (!secrets?.dashboard?.secret) {
    const secret = randomBytes(32).toString('hex');
    await writeEveSecrets({ dashboard: { secret, port } });
    secrets = await readEveSecrets(process.cwd());
    console.log();
    console.log(colors.primary.bold('Dashboard key generated — save this somewhere safe:'));
    console.log(colors.muted('─'.repeat(66)));
    console.log(colors.primary.bold(secret));
    console.log(colors.muted('─'.repeat(66)));
  }

  const dashboardSecret = secrets?.dashboard?.secret ?? '';
  const unit = buildSystemdUnit(port, dashboardSecret, dir);

  console.log();
  printInfo(`Writing ${SERVICE_PATH}...`);
  writeFileSync(SERVICE_PATH, unit, { mode: 0o644 });

  printInfo('Reloading systemd...');
  await execa('systemctl', ['daemon-reload'], { stdio: 'inherit' });

  printInfo('Enabling and starting eve-dashboard service...');
  await execa('systemctl', ['enable', '--now', SERVICE_NAME], { stdio: 'inherit' });

  // Wait briefly, then check status
  await new Promise(r => setTimeout(r, 2000));
  const statusResult = execaSync('systemctl', ['is-active', SERVICE_NAME], { reject: false });
  const isActive = statusResult.stdout?.trim() === 'active';

  console.log();
  if (isActive) {
    printSuccess(`Eve Dashboard is now running as a systemd service.`);
    printInfo(`  Status:  systemctl status ${SERVICE_NAME}`);
    printInfo(`  Logs:    journalctl -u ${SERVICE_NAME} -f`);
    printInfo(`  Stop:    systemctl stop ${SERVICE_NAME}`);
    printInfo(`  Remove:  eve ui --uninstall-service`);
  } else {
    printError(`Service installed but not active. Check: systemctl status ${SERVICE_NAME}`);
  }
  console.log();
}

async function uninstallSystemdService(): Promise<void> {
  if (process.platform !== 'linux') {
    printError('--uninstall-service is Linux-only.');
    process.exit(1);
  }
  if (process.getuid && process.getuid() !== 0) {
    printError('--uninstall-service must be run as root.');
    printInfo('Try: sudo eve ui --uninstall-service');
    process.exit(1);
  }

  console.log();
  printInfo('Stopping and disabling eve-dashboard service...');
  try { await execa('systemctl', ['stop', SERVICE_NAME], { stdio: 'inherit' }); } catch { /* may not be running */ }
  try { await execa('systemctl', ['disable', SERVICE_NAME], { stdio: 'inherit' }); } catch { /* may not be enabled */ }

  if (existsSync(SERVICE_PATH)) {
    const { unlinkSync } = await import('node:fs');
    unlinkSync(SERVICE_PATH);
    printInfo(`Removed ${SERVICE_PATH}`);
  }

  await execa('systemctl', ['daemon-reload'], { stdio: 'inherit' });

  console.log();
  printSuccess('Eve Dashboard service uninstalled.');
  console.log();
}

async function showServiceStatus(): Promise<void> {
  if (process.platform !== 'linux') {
    printWarning('Service mode is Linux-only — `eve ui` runs in foreground on this OS.');
    return;
  }
  console.log();
  if (!existsSync(SERVICE_PATH)) {
    printInfo('Eve Dashboard service is NOT installed.');
    printInfo('  Install with: sudo eve ui --install-service');
    return;
  }
  await execa('systemctl', ['status', SERVICE_NAME, '--no-pager', '-l'], { stdio: 'inherit', reject: false });
}

export function uiCommand(program: Command): void {
  program
    .command('ui')
    .description('Open the Eve web dashboard (or install it as a systemd service)')
    .option('--port <port>', 'Dashboard port', '7979')
    .option('--no-open', 'Do not open browser automatically')
    .option('--rebuild', 'Force rebuild of the dashboard before starting')
    .option('--install-service', 'Install + enable a systemd service so the dashboard auto-starts on boot (Linux, root)')
    .option('--uninstall-service', 'Stop, disable, and remove the systemd service')
    .option('--service-status', 'Show systemd service status')
    .action(async (opts: {
      port: string;
      open: boolean;
      rebuild?: boolean;
      installService?: boolean;
      uninstallService?: boolean;
      serviceStatus?: boolean;
    }) => {
      const port = parseInt(opts.port, 10);

      if (opts.installService) return installSystemdService(port);
      if (opts.uninstallService) return uninstallSystemdService();
      if (opts.serviceStatus) return showServiceStatus();

      const dir = dashboardDir();

      // Ensure dashboard secret exists
      let secrets = await readEveSecrets(process.cwd());

      if (!secrets?.dashboard?.secret) {
        const secret = randomBytes(32).toString('hex');
        await writeEveSecrets({ dashboard: { secret, port } });
        secrets = await readEveSecrets(process.cwd());

        console.log();
        console.log(colors.primary.bold('Dashboard key generated — save this somewhere safe:'));
        console.log(colors.muted('─'.repeat(66)));
        console.log(colors.primary.bold(secret));
        console.log(colors.muted('─'.repeat(66)));
        console.log(colors.muted('You will be prompted for this key when you open the dashboard.'));
      } else {
        console.log();
        console.log(colors.muted('Your dashboard key:'));
        console.log(colors.primary.bold(secrets.dashboard.secret));
      }

      // Warn if a systemd service is already running on the same port — avoids
      // double-binding port 7979 with a foreground process.
      if (process.platform === 'linux' && existsSync(SERVICE_PATH)) {
        try {
          const r = execaSync('systemctl', ['is-active', SERVICE_NAME], { reject: false });
          if (r.stdout?.trim() === 'active') {
            console.log();
            printWarning(`A systemd Eve Dashboard service is already running on port ${port}.`);
            printInfo(`  • View it:   open http://localhost:${port}`);
            printInfo(`  • Status:    eve ui --service-status`);
            printInfo(`  • Stop it:   sudo systemctl stop ${SERVICE_NAME}`);
            console.log();
            return;
          }
        } catch { /* systemd unavailable, fall through */ }
      }

      // Build dashboard if .next/ is missing or --rebuild requested
      const nextDir = join(dir, '.next');
      if (opts.rebuild || !existsSync(nextDir)) {
        console.log();
        const spinner = createSpinner('Building dashboard (first run — takes ~30s)...');
        spinner.start();
        try {
          await execa('pnpm', ['build'], { cwd: dir, env: { ...process.env } });
          spinner.succeed('Dashboard built');
        } catch (err) {
          spinner.fail('Dashboard build failed');
          console.error(err instanceof Error ? err.message : String(err));
          process.exit(1);
        }
      }

      const url = `http://localhost:${port}`;
      console.log();
      console.log(`${emojis.entity}  Starting Eve Dashboard → ${colors.primary(url)}`);
      console.log();
      if (process.platform === 'linux') {
        printInfo('Tip: install as a systemd service so it auto-starts on boot:');
        printInfo('  sudo eve ui --install-service');
        console.log();
      }

      // Open browser after a short delay
      if (opts.open) {
        setTimeout(() => {
          const opener =
            process.platform === 'darwin'
              ? 'open'
              : process.platform === 'win32'
                ? 'start'
                : 'xdg-open';
          execa(opener, [url]).catch(() => {});
        }, 2500);
      }

      const finalSecrets = await readEveSecrets(process.cwd());
      await execa('pnpm', ['start', '--port', String(port)], {
        cwd: dir,
        stdio: 'inherit',
        env: {
          ...process.env,
          PORT: String(port),
          EVE_DASHBOARD_SECRET: finalSecrets?.dashboard?.secret ?? '',
        },
      });
    });
}
