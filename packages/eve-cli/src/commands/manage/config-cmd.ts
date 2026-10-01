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

  /**
   * Switch where Remotion renders — the "change my mind later" door.
   *
   * Remotion is the one Eve component that may legitimately already exist
   * outside Eve, so pointing at an external renderer is a first-class mode, not
   * a config escape hatch. `--mode container` walks it back and re-enables the
   * pod-local renderer on the next `eve add remotion`.
   *
   * The URL is validated for SHAPE only, not reachability: a renderer that is
   * simply not up yet is a legitimate thing to point at, and refusing to record
   * it would make the flag useless exactly when it is needed. `eve doctor`
   * reports reachability separately.
   */
  cfg
    .command('set-remotion-url')
    .description('Point Remotion at an external renderer (or back to the pod-local one)')
    .argument('[url]', 'Renderer base URL, e.g. https://render.example.com')
    .option('--mode <mode>', 'container | external', 'external')
    .option('--token <token>', 'Token an external renderer requires (X-Remotion-Token)')
    .action(async (url: string | undefined, opts: { mode?: string; token?: string }) => {
      try {
        const { readEveSecrets, writeEveSecrets } = await import('@eve/dna');
        const mode = opts.mode ?? 'external';

        if (mode === 'container') {
          await writeEveSecrets({
            builder: { remotion: { mode: 'container', url: undefined, apiToken: undefined } },
          });
          printInfo('Remotion will render on this pod.');
          printInfo('  Bring the renderer back with: eve add remotion');
          return;
        }

        if (mode !== 'external') {
          printError(`Unknown mode "${mode}". Use: container | external`);
          process.exit(1);
        }

        if (!url) {
          printError('A renderer URL is required.');
          printInfo('  eve config set-remotion-url https://render.example.com');
          printInfo('  Back to the pod-local renderer: eve config set-remotion-url --mode container');
          process.exit(1);
        }

        let parsed: URL;
        try {
          parsed = new URL(url);
        } catch {
          printError(`Not a valid URL: ${url}`);
          process.exit(1);
        }
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          printError(`Only http/https URLs are supported (got ${parsed.protocol}).`);
          process.exit(1);
        }

        const normalized = parsed.toString().replace(/\/$/, '');
        const previous = await readEveSecrets(process.cwd());
        await writeEveSecrets({
          builder: { remotion: { mode: 'external', url: normalized, apiToken: opts.token } },
        });

        printInfo(`Remotion will render at ${colors.primary(normalized)}.`);
        if (previous?.builder?.remotion?.mode === 'container') {
          printInfo('  A pod-local renderer may still be running — stop it with: eve remove remotion');
        }
      } catch (e) {
        printError(e instanceof Error ? e.message : String(e));
        process.exit(1);
      }
    });

  cfg
    .command('remotion-status')
    .description('Show which Remotion renderer this pod is configured to use')
    .action(async () => {
      try {
        const { readEveSecrets } = await import('@eve/dna');
        const remotion = (await readEveSecrets(process.cwd()))?.builder?.remotion;
        const mode = remotion?.mode ?? 'container';
        const payload = {
          mode,
          target: mode === 'external' ? remotion?.url : 'http://eve-builder-remotion:8080 (on this pod)',
          hasToken: Boolean(remotion?.apiToken),
        };
        if (getGlobalCliFlags().json) {
          outputJson(payload);
        } else {
          console.log(JSON.stringify(payload, null, 2));
        }
      } catch (e) {
        printError(e instanceof Error ? e.message : String(e));
        process.exit(1);
      }
    });
}
