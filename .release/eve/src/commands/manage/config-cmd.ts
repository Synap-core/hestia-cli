import { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import { configManager } from '@eve/dna';
import { getGlobalCliFlags, outputJson } from '@eve/cli-kit';
import { colors, printInfo, printError } from '../../lib/ui.js';

export function configCommands(program: Command): void {
  const cfg = program.command('config').description('Eve YAML config (~/.config/eve/config.yaml)');

  cfg
    .command('path')
    .description('Print path to config file')
    .action(() => {
      console.log(configManager.getConfigPath());
    });

  cfg
    .command('show')
    .description('Load and print config (JSON)')
    .action(async () => {
      try {
        const c = await configManager.loadConfig();
        const plain = {
          ...c,
          createdAt: c.createdAt instanceof Date ? c.createdAt.toISOString() : c.createdAt,
          updatedAt: c.updatedAt instanceof Date ? c.updatedAt.toISOString() : c.updatedAt,
        };
        if (getGlobalCliFlags().json) {
          outputJson(plain);
        } else {
          console.log(JSON.stringify(plain, null, 2));
        }
      } catch (e) {
        printError(e instanceof Error ? e.message : String(e));
        process.exit(1);
      }
    });

  cfg
    .command('dump')
    .description('Print raw YAML file contents')
    .action(async () => {
      try {
        const p = configManager.getConfigPath();
        const raw = await readFile(p, 'utf-8');
        console.log(raw);
      } catch (e) {
        printError(e instanceof Error ? e.message : String(e));
        process.exit(1);
      }
    });

  cfg
    .command('set-entity-name')
    .description('Set entity display name in config')
    .argument('<name>', 'New entity name')
    .action(async (name: string) => {
      try {
        await configManager.updateConfig({ name });
        printInfo(`Updated entity name to ${colors.primary(name)}`);
      } catch (e) {
        printError(e instanceof Error ? e.message : String(e));
        process.exit(1);
      }
    });
}
