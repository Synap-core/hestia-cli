import { Command } from 'commander';
import { execa } from 'execa';
import { entityStateManager, configManager } from '@eve/dna';
import { getGlobalCliFlags, outputJson } from '@eve/cli-kit';
import { colors, printInfo } from '../../lib/ui.js';

export function inspectCommand(program: Command): void {
  program
    .command('inspect')
    .description('Dump entity state, config path, and Eve-related containers (JSON)')
    .option('--containers-only', 'Only run docker ps filter')
    .action(async (opts: { containersOnly?: boolean }) => {
      try {
        let containers: Array<{ name: string; status: string; image: string }> = [];
        try {
          const { stdout } = await execa('docker', [
            'ps',
            '-a',
            '--filter',
            'name=eve-',
            '--format',
            '{{.Names}}\t{{.Status}}\t{{.Image}}',
          ]);
          containers = stdout
            .trim()
            .split('\n')
            .filter(Boolean)
            .map((line) => {
              const [name, status, image] = line.split('\t');
              return { name: name ?? '', status: status ?? '', image: image ?? '' };
            });
        } catch {
          containers = [];
        }

        if (opts.containersOnly) {
          const payload = { containers };
          if (getGlobalCliFlags().json) {
            outputJson(payload);
          } else {
            console.log(JSON.stringify(payload, null, 2));
          }
          return;
        }

        const state = await entityStateManager.getState();
        const cfgPath = configManager.getConfigPath();

        const payload = {
          entityState: state,
          configPath: cfgPath,
          containers,
        };

        if (getGlobalCliFlags().json) {
          outputJson(payload);
        } else {
          console.log(JSON.stringify(payload, null, 2));
          printInfo(`Config file: ${colors.muted(cfgPath)}`);
        }
      } catch (e) {
        console.error(e);
        process.exit(1);
      }
    });
}
