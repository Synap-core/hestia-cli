/**
 * `eve ui` — open the Eve Dashboard in a browser, with optional rebuild.
 *
 * The dashboard runs as a Docker service (`eve-dashboard`), installed via
 * `eve add eve-dashboard`. This command exists for the common case of
 * "open the URL" plus quick `--rebuild` and status helpers.
 */

import type { Command } from 'commander';
import { execa } from 'execa';
import { randomBytes } from 'node:crypto';
import { readEveSecrets, writeEveSecrets } from '@eve/dna';
import {
  installDashboardContainer,
  uninstallDashboardContainer,
  dashboardContainerName,
  dashboardIsRunning,
} from '@eve/legs';
import { colors, emojis, printSuccess, printError, printInfo, printWarning } from '../lib/ui.js';

async function ensureDashboardSecret(port: number): Promise<string> {
  const existing = await readEveSecrets(process.cwd());
  if (existing?.dashboard?.secret) {
    return existing.dashboard.secret;
  }
  const secret = randomBytes(32).toString('hex');
  await writeEveSecrets({ dashboard: { secret, port } });
  console.log();
  console.log(colors.primary.bold('Dashboard key generated — save this somewhere safe:'));
  console.log(colors.muted('─'.repeat(66)));
  console.log(colors.primary.bold(secret));
  console.log(colors.muted('─'.repeat(66)));
  console.log(colors.muted('You will be prompted for this key when you open the dashboard.'));
  return secret;
}

function openBrowser(url: string): void {
  const opener =
    process.platform === 'darwin' ? 'open' :
    process.platform === 'win32' ? 'start' :
    'xdg-open';
  execa(opener, [url]).catch(() => { /* headless box, no browser */ });
}

export function uiCommand(program: Command): void {
  program
    .command('ui')
    .description('Open the Eve web dashboard')
    .option('--port <port>', 'Host port the dashboard is exposed on', '7979')
    .option('--no-open', 'Do not open the browser automatically')
    .option('--rebuild', 'Rebuild the dashboard image and restart the container')
    .option('--stop', 'Stop and remove the dashboard container')
    .option('--status', 'Show whether the dashboard container is running')
    .action(async (opts: {
      port: string;
      open: boolean;
      rebuild?: boolean;
      stop?: boolean;
      status?: boolean;
    }) => {
      const port = parseInt(opts.port, 10);

      if (opts.status) {
        if (dashboardIsRunning()) {
          printSuccess(`Eve Dashboard is running (container: ${dashboardContainerName()})`);
          printInfo(`  Logs:  docker logs -f ${dashboardContainerName()}`);
        } else {
          printWarning('Eve Dashboard is NOT running.');
          printInfo('  Install/start it with: eve add eve-dashboard');
        }
        return;
      }

      if (opts.stop) {
        try {
          uninstallDashboardContainer();
          printSuccess('Eve Dashboard stopped.');
          printInfo('  Restart it with: eve add eve-dashboard');
        } catch (err) {
          printError(`Stop failed: ${err instanceof Error ? err.message : String(err)}`);
          process.exit(1);
        }
        return;
      }

      if (opts.rebuild) {
        const secret = await ensureDashboardSecret(port);
        try {
          installDashboardContainer({
            workspaceRoot: process.cwd(),
            secret,
            rebuild: true,
          });
          printSuccess('Eve Dashboard rebuilt and restarted.');
        } catch (err) {
          printError(`Rebuild failed: ${err instanceof Error ? err.message : String(err)}`);
          process.exit(1);
        }
        // Fall through to open the URL.
      }

      // Default action: print key + URL, optionally open browser.
      const secrets = await readEveSecrets(process.cwd());
      const secret = secrets?.dashboard?.secret;

      if (!dashboardIsRunning()) {
        printWarning('Eve Dashboard is not running.');
        printInfo('  Start it with: eve add eve-dashboard');
        return;
      }

      const url = `http://localhost:${port}`;
      console.log();
      if (secret) {
        console.log(colors.muted('Your dashboard key:'));
        console.log(colors.primary.bold(secret));
        console.log();
      }
      console.log(`${emojis.entity}  Eve Dashboard → ${colors.primary(url)}`);
      console.log();

      if (opts.open) openBrowser(url);
    });
}
