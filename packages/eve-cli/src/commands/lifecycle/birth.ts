import { Command } from 'commander';
import { execa } from 'execa';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { getCreateUsbScriptPath } from '@eve/usb';
import { colors, emojis, printInfo, printError } from '../../lib/ui.js';

const require = createRequire(import.meta.url);

function resolveInstallScript(): string {
  try {
    const pkgJson = require.resolve('@eve/install/package.json');
    return join(dirname(pkgJson), 'src', 'install.sh');
  } catch {
    return '';
  }
}

export function birthCommand(program: Command): void {
  const birth = program.command('birth').description('Bare-metal provisioning (USB) and host install scripts');

  birth
    .command('usb')
    .description(
      'Create a bootable USB with Ventoy + autoinstall (runs bash script). After hestia usb create, copy ~/.eve/usb-profile.json to /opt/eve/profile.json on the server for eve setup to pick up the profile.',
    )
    .argument('[device]', 'Block device e.g. /dev/sdb (omit for interactive script)')
    .action(async (device: string | undefined) => {
      try {
        const script = getCreateUsbScriptPath();
        const args = device ? [script, device] : [script];
        printInfo(`${emojis.info} Running USB creation script...\n`);
        await execa('bash', args, { stdio: 'inherit' });
      } catch (e) {
        printError(e instanceof Error ? e.message : String(e));
        process.exit(1);
      }
    });

  birth
    .command('install')
    .description('Run server install script from @eve/install (phase scripts)')
    .option('--phase <n>', 'Run only phase1 | phase2 | phase3 | all', 'all')
    .action(async (opts: { phase?: string }) => {
      const script = resolveInstallScript();
      if (!script) {
        printError('@eve/install not found. Add workspace dependency and pnpm install.');
        process.exit(1);
      }
      printInfo(`${emojis.info} Install script: ${script}`);
      printInfo(`Phase filter: ${opts.phase ?? 'all'} (pass through to script if supported)\n`);
      try {
        await execa('bash', [script], { stdio: 'inherit' });
      } catch {
        process.exit(1);
      }
    });
}
