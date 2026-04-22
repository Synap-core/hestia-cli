import { Command } from 'commander';
import { execa } from 'execa';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { getGlobalCliFlags } from '@eve/cli-kit';
import {
  printInfo,
  printError,
  colors,
  printEveDeprecation,
  requireDelegationConfirmed,
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
    .description('Guidance for updating Eve / Synap images (use synap-backend deploy on the Data Pod)')
    .action(() => {
      printEveDeprecation('update', './synap update (on your server)');
      requireDelegationConfirmed();

      printInfo(
        'Eve does not replace your Data Pod updater. For Synap: use your deploy directory `./synap update` or pull new images and run migrations as documented in synap-backend/deploy.'
      );
      printInfo(`Compose hint: ${colors.muted('docker compose pull && docker compose up -d')} in the directory that owns your stack.`);
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
