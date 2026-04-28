import type { Command } from 'commander';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { readEveSecrets, writeEveSecrets } from '@eve/dna';
import { colors, emojis } from '../lib/ui.js';

const __filename = fileURLToPath(import.meta.url);
// tsup bundles everything to dist/index.js, so:
// __filename = .../packages/eve-cli/dist/index.js
// 3 levels up = packages/
const packagesDir = join(__filename, '..', '..', '..');

function dashboardDir(): string {
  return join(packagesDir, 'eve-dashboard');
}

export function uiCommand(program: Command): void {
  program
    .command('ui')
    .description('Open the Eve web dashboard')
    .option('--port <port>', 'Dashboard port', '7979')
    .option('--no-open', 'Do not open browser automatically')
    .action(async (opts: { port: string; open: boolean }) => {
      const port = parseInt(opts.port, 10);

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

      const url = `http://localhost:${port}`;
      console.log();
      console.log(`${emojis.entity}  Starting Eve Dashboard → ${colors.primary(url)}`);
      console.log();

      // Open browser after a short delay
      if (opts.open) {
        setTimeout(() => {
          const opener =
            process.platform === 'darwin'
              ? 'open'
              : process.platform === 'win32'
                ? 'start'
                : 'xdg-open';
          execa(opener, [url]).catch(() => {
            // non-fatal if browser open fails
          });
        }, 2500);
      }

      const finalSecrets = await readEveSecrets(process.cwd());
      const dir = dashboardDir();
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
