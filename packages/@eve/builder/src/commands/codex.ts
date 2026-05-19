import type { Command } from 'commander';
import { readEveSecrets, readAgentKeyOrLegacy, resolveHubBaseUrl } from '@eve/dna';
import { CodexFeaturePoller } from '../lib/codex-feature-poller.js';
import { CodexPipeline, type CodePhase } from '../lib/codex-pipeline.js';

const CODE_PHASES: CodePhase[] = ['executing', 'verifying', 'debugging'];

export function registerCodexCommands(parentCmd: Command): void {
  const codex = parentCmd
    .command('codex')
    .description('Codex code-execution engine via T3 Code');

  codex
    .command('daemon')
    .description(
      'Start the Codex feature-polling daemon.\n' +
        'Handles executing / verifying / debugging pipeline phases via T3 Code.\n' +
        'Requires: secrets.builder.t3code.url and a valid agent API key.',
    )
    .option('--poll-interval <ms>', 'Poll interval in milliseconds', '15000')
    .action(async (opts: { pollInterval: string }) => {
      const secrets = await readEveSecrets();
      const t3cfg = secrets?.builder?.t3code;

      if (!t3cfg?.url) {
        console.error(
          '[codex daemon] T3 Code URL not configured.\n' +
            'Set it with: eve config set builder.t3code.url ws://<host>:<port>',
        );
        process.exit(1);
      }

      const hubBaseUrl = resolveHubBaseUrl(secrets);
      if (!hubBaseUrl) {
        console.error('[codex daemon] Synap pod URL not configured. Run: eve setup');
        process.exit(1);
      }

      const apiKey = await readAgentKeyOrLegacy('codex');
      if (!apiKey) {
        console.error('[codex daemon] No agent API key found. Run: eve setup');
        process.exit(1);
      }

      const poller = new CodexFeaturePoller({
        hubBaseUrl,
        apiKey,
        t3codeUrl: t3cfg.url,
        t3codeApiKey: t3cfg.apiKey,
        pollIntervalMs: parseInt(opts.pollInterval, 10),
      });

      process.on('SIGINT', () => {
        poller.stop();
        process.exit(0);
      });
      process.on('SIGTERM', () => {
        poller.stop();
        process.exit(0);
      });

      await poller.start();
    });

  codex
    .command('run <featureId> <phase>')
    .description(
      'Run a single code phase for a feature (one-shot, no polling).\n' +
        'Valid phases: executing | verifying | debugging',
    )
    .action(async (featureId: string, phase: string) => {
      if (!CODE_PHASES.includes(phase as CodePhase)) {
        console.error(`Invalid phase: "${phase}". Must be one of: ${CODE_PHASES.join(', ')}`);
        process.exit(1);
      }

      const secrets = await readEveSecrets();
      const t3cfg = secrets?.builder?.t3code;

      if (!t3cfg?.url) {
        console.error('[codex run] T3 Code URL not configured.');
        process.exit(1);
      }

      const hubBaseUrl = resolveHubBaseUrl(secrets);
      if (!hubBaseUrl) {
        console.error('[codex run] Synap pod URL not configured.');
        process.exit(1);
      }

      const apiKey = await readAgentKeyOrLegacy('codex');
      if (!apiKey) {
        console.error('[codex run] No agent API key found.');
        process.exit(1);
      }

      const pipeline = new CodexPipeline({
        t3codeUrl: t3cfg.url,
        t3codeApiKey: t3cfg.apiKey,
        hubBaseUrl,
        apiKey,
      });

      await pipeline.runPhase(featureId, phase as CodePhase);
      console.log('Done.');
    });

  codex
    .command('status')
    .description('Show T3 Code configuration status')
    .action(async () => {
      const secrets = await readEveSecrets();
      const t3cfg = secrets?.builder?.t3code;
      const hubBaseUrl = resolveHubBaseUrl(secrets);

      console.log('T3 Code configuration:');
      console.log(`  URL:     ${t3cfg?.url ?? '(not set)'}`);
      console.log(`  API key: ${t3cfg?.apiKey ? '(set)' : '(not set)'}`);
      console.log(`  Hub:     ${hubBaseUrl ?? '(not set)'}`);
    });
}
