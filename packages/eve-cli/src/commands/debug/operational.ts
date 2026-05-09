import { Command } from 'commander';
import {
  buildConfigDebugPayload,
  buildDiscoveryDebugPayload,
  buildEventsDebugPayload,
  buildMaterializedDebugPayload,
} from '@eve/dna';
import { getGlobalCliFlags, outputJson } from '@eve/cli-kit';

type DebugTopic = 'config' | 'discovery' | 'materialized' | 'events';

async function buildPayload(topic: DebugTopic, opts: { limit?: string }) {
  switch (topic) {
    case 'config':
      return buildConfigDebugPayload();
    case 'discovery':
      return buildDiscoveryDebugPayload();
    case 'materialized':
      return buildMaterializedDebugPayload();
    case 'events': {
      const limit = opts.limit ? Number.parseInt(opts.limit, 10) : 100;
      return buildEventsDebugPayload(Number.isFinite(limit) ? limit : 100);
    }
  }
}

export function debugCommand(program: Command): void {
  const debug = program
    .command('debug')
    .description('Inspect Eve operational config, discovery, materialized outputs, and events');

  for (const topic of ['config', 'discovery', 'materialized', 'events'] as const) {
    const command = debug
      .command(topic)
      .description(`Print ${topic} debug payload`)
      .action(async (opts: { limit?: string }) => {
        try {
          const payload = await buildPayload(topic, opts);
          if (getGlobalCliFlags().json) {
            outputJson(payload);
          } else {
            console.log(JSON.stringify(payload, null, 2));
          }
        } catch (error) {
          console.error(error instanceof Error ? error.message : String(error));
          process.exit(1);
        }
      });

    if (topic === 'events') {
      command.option('--limit <n>', 'Number of recent events', '100');
    }
  }
}
