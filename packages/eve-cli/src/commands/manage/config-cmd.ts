import { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import { configManager, readEveSecrets } from '@eve/dna';
import { getGlobalCliFlags, outputJson } from '@eve/cli-kit';
import { colors, printInfo, printError } from '../../lib/ui.js';

const CHANNEL_PLATFORMS = ['telegram', 'discord', 'whatsapp', 'signal', 'matrix', 'slack'] as const;

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

        // Augment with effective channel routing from secrets so the default
        // ("hermes" for any unconfigured platform) is visible without reading
        // secrets.json directly.
        const secrets = await readEveSecrets().catch(() => null);
        const routing = secrets?.channelRouting ?? {};
        const effectiveChannelRouting = Object.fromEntries(
          CHANNEL_PLATFORMS.map(p => [
            p,
            routing[p] ? routing[p] : `hermes (default)`,
          ]),
        );

        const output = { ...plain, effectiveChannelRouting };
        if (getGlobalCliFlags().json) {
          outputJson(output);
        } else {
          console.log(JSON.stringify(output, null, 2));
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
