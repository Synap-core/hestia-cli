import { Command } from 'commander';
import { execa } from 'execa';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { getGlobalCliFlags } from '@eve/cli-kit';
import {
  printInfo,
  printError,
  colors,
} from '../../lib/ui.js';

async function confirmDestructiveReset(): Promise<boolean> {
  const flags = getGlobalCliFlags();
  if (flags.nonInteractive) return true;

  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question("Type 'recreate' to continue: ");
    return answer.trim() === 'recreate';
  } finally {
    rl.close();
  }
}

export function backupUpdateCommands(program: Command): void {
  program
    .command('backup')
    .description('List Eve-related Docker volumes (full backup: stop stack + docker run volume export — see docs)')
    .action(async () => {
      try {
        const { stdout } = await execa('docker', ['volume', 'ls', '--format', '{{.Name}}']);
        const vols = stdout
          .split('\n')
          .filter((n) => n.includes('eve') || n.includes('ollama') || n.includes('synap'));
        if (vols.length === 0) {
          printInfo('No matching volumes found. Create the stack with eve brain init first.');
          return;
        }
        console.log(colors.primary.bold('Docker volumes (candidates for backup):\n'));
        for (const v of vols) {
          console.log(`  ${v}`);
        }
        printInfo('\nTip: align volume backups with your synap-backend deploy backup process when on production.');
      } catch (e) {
        printError(e instanceof Error ? e.message : String(e));
        process.exit(1);
      }
    });

  program
    .command('update')
    .description('Pull latest images and restart Synap Data Pod (works for image-based installs)')
    .option('--synap-only', 'Only update Synap backend (not other Eve containers)')
    .action(async (opts: { synapOnly?: boolean }) => {
      // Detect image-based install at /opt/synap-backend
      const deployDirs = ['/opt/synap-backend', process.env.SYNAP_DEPLOY_DIR].filter(Boolean) as string[];
      const deployDir = deployDirs.find(d => existsSync(join(d, 'docker-compose.yml')));

      if (deployDir) {
        printInfo(`Found Synap deploy at ${colors.info(deployDir)}`);
        const env = { ...process.env, COMPOSE_PROJECT_NAME: 'synap-backend' };
        try {
          printInfo('Pulling latest backend images...');
          await execa('docker', ['compose', 'pull', 'backend', 'realtime', '--ignore-pull-failures'], {
            cwd: deployDir,
            env,
            stdio: 'inherit',
          });

          printInfo('Running database migrations...');
          await execa('docker', ['compose', 'run', '--rm', 'backend-migrate'], {
            cwd: deployDir,
            env,
            stdio: 'inherit',
          });

          printInfo('Restarting backend + realtime...');
          await execa('docker', ['compose', 'up', '-d', 'backend', 'realtime'], {
            cwd: deployDir,
            env,
            stdio: 'inherit',
          });

          printInfo(`${colors.success('✓')} Synap Data Pod updated.`);
        } catch (e) {
          printError(e instanceof Error ? e.message : String(e));
          process.exit(1);
        }
        return;
      }

      // Fallback: delegate to synap-backend checkout
      printInfo('No image-based install found at /opt/synap-backend.');
      printInfo('If using a synap-backend checkout, run: ./synap update  (in your deploy dir)');
      printInfo(`Or pull images manually: ${colors.muted('docker compose pull && docker compose up -d')}`);
    });

  program
    .command('recreate')
    .description('Full cleanup + full recreation (remove stale Docker data and rebuild stack)')
    .option('--no-prune', 'Skip docker system prune')
    .action(async (opts: { prune?: boolean }) => {
      try {
        console.log(colors.error.bold('\n⚠️  Dangerous operation: full cleanup + recreation\n'));
        console.log('This command will:');
        console.log('  - stop and remove all compose resources in the current directory');
        console.log('  - remove project volumes (data loss)');
        if (opts.prune !== false) {
          console.log('  - prune stale Docker containers/images/volumes/networks');
        }
        console.log('');

        const confirmed = await confirmDestructiveReset();
        if (!confirmed) {
          printInfo('Cancelled.');
          return;
        }

        printInfo('Stopping stack and removing compose resources...');
        await execa('docker', ['compose', 'down', '--volumes', '--remove-orphans'], { stdio: 'inherit' });

        if (opts.prune !== false) {
          printInfo('Pruning stale Docker resources...');
          await execa('docker', ['system', 'prune', '-a', '-f', '--volumes'], { stdio: 'inherit' });
        }

        printInfo('Recreating stack...');
        await execa('docker', ['compose', 'up', '-d'], { stdio: 'inherit' });
        printInfo('Done. Stack recreated from clean state.');
      } catch (e) {
        printError(e instanceof Error ? e.message : String(e));
        process.exit(1);
      }
    });
}
