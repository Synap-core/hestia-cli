import { Command } from 'commander';
import { execa } from 'execa';
import { printInfo, printError, colors } from '../../lib/ui.js';

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
      printInfo(
        'Eve does not replace your Data Pod updater. For Synap: use your deploy directory `./synap update` or pull new images and run migrations as documented in synap-backend/deploy.'
      );
      printInfo(`Compose hint: ${colors.muted('docker compose pull && docker compose up -d')} in the directory that owns your stack.`);
    });
}
