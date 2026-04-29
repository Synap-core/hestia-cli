import { Command } from 'commander';
import { printInfo, printError } from '../../lib/ui.js';

export function birthCommand(program: Command): void {
  const birth = program.command('birth').description('Bare-metal provisioning (USB) and host install scripts');

  birth
    .command('usb')
    .description('Create a bootable USB with Ventoy + autoinstall (coming soon)')
    .action(async () => {
      printInfo('USB creation script not yet implemented. This will use a Ventoy-based autoinstall profile.');
    });

  birth
    .command('install')
    .description('Run server install script (coming soon)')
    .option('--phase <n>', 'Run only phase1 | phase2 | phase3 | all', 'all')
    .action(async (_opts: { phase?: string }) => {
      printInfo('Install script not yet implemented. Use `eve setup` for the current install flow.');
    });
}
