import { Command } from 'commander';
import {
  readEveSecrets,
  readAgentKeyOrLegacySync,
  buildOpenwebuiModelSources,
  buildOpenwebuiManagedConfig,
  registerOpenwebuiAdminApi,
  syncOpenwebuiExtras,
  formatExtrasSummary,
} from '@eve/dna';
import { renewAgentKey } from '@eve/lifecycle';
import { createSpinner, printSuccess, printError, printWarning, colors } from '../lib/ui.js';

export function openwebuiCommand(program: Command): void {
  const owui = program
    .command('openwebui')
    .alias('owui')
    .description('OpenWebUI management commands');

  owui
    .command('sync')
    .description(
      'Re-register all model sources in OpenWebUI via the admin API.\n' +
      'Use this to recover when `eve start` or `eve ai apply` succeeded\n' +
      'but models are missing from the OpenWebUI model picker.',
    )
    .option(
      '--max-retries <n>',
      'Health check attempts before giving up (each attempt waits 5 s, default: 24 = 2 min)',
      '24',
    )
    .option('--skip-extras', 'Skip the extras sync (skills / knowledge / tools)')
    .action(async (opts: { maxRetries: string; skipExtras?: boolean }) => {
      const maxRetries = Math.max(1, parseInt(opts.maxRetries, 10) || 24);
      const secrets = await readEveSecrets(process.cwd());

      const synapApiKey = readAgentKeyOrLegacySync('eve', secrets);
      if (!synapApiKey) {
        printError('No Synap API key found for the eve agent — install Synap first (`eve add synap`)');
        process.exit(1);
      }

      const { modelSources } = buildOpenwebuiModelSources(secrets, '/opt/openwebui');

      // Apply correct keys (same logic as wireOpenwebui in wire-ai.ts)
      if (modelSources.length > 0) modelSources[0].apiKey = synapApiKey;
      const hermesApiServerKey = secrets?.builder?.hermes?.apiServerKey;
      const hermesIdx = modelSources.findIndex(m => m.displayName === 'Hermes Gateway');
      if (hermesIdx >= 0) modelSources[hermesIdx].apiKey = hermesApiServerKey ?? '';

      console.log(colors.muted(`  ${modelSources.length} model source(s) to register`));
      console.log(colors.muted(`  Health check budget: ${maxRetries} × 5 s = ${maxRetries * 5} s`));
      console.log();

      const spinner = createSpinner(`Waiting for OpenWebUI (up to ${maxRetries * 5} s)…`);
      spinner.start();

      const outcome = await registerOpenwebuiAdminApi(modelSources, {
        managedConfig: buildOpenwebuiManagedConfig(secrets),
        maxRetries,
      });

      if (!outcome.ok) {
        spinner.fail(`Registration failed at stage='${outcome.stage}'`);
        printError(outcome.reason);
        console.log();
        printWarning('Likely fix per stage:');
        console.log(colors.muted("  health        → docker ps --filter name=hestia-openwebui --format '{{.Ports}}'"));
        console.log(colors.muted('                  curl -sI http://127.0.0.1:3011/health'));
        console.log(colors.muted("  secret-key    → grep '^WEBUI_SECRET_KEY=' /opt/openwebui/.env"));
        console.log(colors.muted('  admin-row     → docker exec hestia-openwebui sqlite3 /app/backend/data/webui.db "SELECT id,email,role FROM user"'));
        console.log(colors.muted('  jwt-rejected  → check OWUI version; admin JWT format may have changed'));
        console.log(colors.muted('  reconcile     → docker logs hestia-openwebui --tail 30'));
        console.log();
        printWarning('After fixing, re-run: eve openwebui sync');
        process.exit(1);
      }

      spinner.succeed(`${modelSources.length} model source(s) registered in OpenWebUI`);

      if (!opts.skipExtras) {
        const extrasSpinner = createSpinner('Syncing extras (skills / knowledge / tools)…');
        extrasSpinner.start();
        try {
          let extras = await syncOpenwebuiExtras(process.cwd(), secrets);
          // Auto-recover from a stale eve hubApiKey. The skills + knowledge
          // pushes call Synap's Hub Protocol with `secrets.agents.eve.hubApiKey`;
          // if that key was revoked / expired, every push returns 401 and the
          // user is left with no Synap surfaces in OpenWebUI. Detect the 401
          // signature, mint a fresh key via /setup/agent, then retry once.
          const has401 = formatExtrasSummary(extras).match(/\b401\b|Unauthorized/i);
          if (has401) {
            extrasSpinner.text = 'Detected 401 on Synap pushes — renewing eve agent key…';
            const renew = await renewAgentKey({ agentType: 'eve', reason: 'owui-sync-401-recover' });
            if (renew.renewed) {
              extrasSpinner.text = 'Retrying extras with fresh eve key…';
              const refreshed = await readEveSecrets(process.cwd());
              extras = await syncOpenwebuiExtras(process.cwd(), refreshed);
            } else {
              extrasSpinner.warn(
                `Skills/knowledge returned 401 and renewal failed (${renew.reason}). ` +
                `Run \`eve auth provision --agent eve\` then retry.`,
              );
            }
          }
          extrasSpinner.succeed(formatExtrasSummary(extras));
        } catch (err) {
          extrasSpinner.warn(`Extras sync failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      console.log();
      printSuccess('Sync complete. Models should now appear in the OpenWebUI model picker.');
      printSuccess('Run `eve doctor` to verify the full registration status.');
    });
}
