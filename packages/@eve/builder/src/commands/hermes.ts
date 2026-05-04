import { HermesDaemon, type HermesConfig } from '../lib/hermes-daemon';
import { readAgentKeyOrLegacySync, readEveSecrets } from '@eve/dna';

let daemon: HermesDaemon | null = null;

/**
 * Load Hermes defaults from `~/.eve/secrets.json` so the dashboard's
 * saved settings (`builder.hermes.*`, `synap.apiUrl`, `agents.hermes`)
 * are picked up by `eve builder hermes start` without the user having
 * to pass every value as a CLI flag.
 *
 * Hermes is its own agent on the pod (`agents.hermes.hubApiKey`); we
 * fall back to the legacy single key for un-migrated installs.
 *
 * CLI args override file-based defaults (most specific wins).
 */
async function loadDefaultsFromSecrets(): Promise<Partial<HermesConfig>> {
  const s = await readEveSecrets();
  if (!s) return {};
  const h = s.builder?.hermes ?? {};
  const out: Partial<HermesConfig> = {};
  if (h.enabled !== undefined) out.enabled = h.enabled;
  if (h.pollIntervalMs !== undefined) out.pollIntervalMs = h.pollIntervalMs;
  if (h.maxConcurrentTasks !== undefined) out.maxConcurrentTasks = h.maxConcurrentTasks;
  if (s.synap?.apiUrl) out.apiUrl = s.synap.apiUrl;
  const hermesKey = readAgentKeyOrLegacySync('hermes', s);
  if (hermesKey) out.apiKey = hermesKey;
  if (s.builder?.workspaceDir) out.workspaceDir = s.builder.workspaceDir;
  return out;
}

/**
 * Hermes CLI commands — start, stop, status, poll, logs.
 */
export function registerHermesCommands(yargs: any) {
  return yargs
    .command('start', 'Start the Hermes daemon (polls Synap for tasks)', (yargs: any) => {
      return yargs
        .option('poll-interval', {
          type: 'number',
          default: undefined,
          description: 'Poll interval in milliseconds (default: 30000)',
        })
        .option('max-concurrent', {
          type: 'number',
          default: undefined,
          description: 'Max concurrent tasks (default: 1)',
        })
        .option('api-url', {
          type: 'string',
          default: undefined,
          description: 'Synap API URL',
        })
        .option('api-key', {
          type: 'string',
          default: undefined,
          description: 'Synap API key',
        })
        .option('workspace', {
          type: 'string',
          default: undefined,
          description: 'Workspace directory',
        });
    }, async (argv: any) => {
      // 1. Defaults from secrets (set via `eve dashboard` settings)
      const fileConfig = await loadDefaultsFromSecrets();

      // 2. CLI args override the file (most-specific wins)
      const argConfig: Record<string, unknown> = {};
      if (argv.pollInterval != null) argConfig.pollIntervalMs = argv.pollInterval;
      if (argv.maxConcurrent != null) argConfig.maxConcurrentTasks = argv.maxConcurrent;
      if (argv.apiUrl != null) argConfig.apiUrl = argv.apiUrl;
      if (argv.apiKey != null) argConfig.apiKey = argv.apiKey;
      if (argv.workspace != null) argConfig.workspaceDir = argv.workspace;

      const config = { ...fileConfig, ...argConfig } as Partial<HermesConfig>;

      // Honor the dashboard `enabled` switch — the daemon refuses to
      // start when off so users can pre-configure settings without
      // accidentally launching it.
      if (config.enabled === false) {
        console.log('[Hermes] Daemon is disabled in secrets.json (builder.hermes.enabled = false).');
        console.log('  Toggle it on from the dashboard or pass --force (not yet wired) to override.');
        return;
      }

      daemon = new HermesDaemon(config);

      // Handle Ctrl+C
      process.on('SIGINT', () => daemon?.stop());
      process.on('SIGTERM', () => daemon?.stop());

      await daemon.start();
    })
    .command('stop', 'Stop the Hermes daemon', async () => {
      if (!daemon) {
        console.log('[Hermes] Daemon is not running');
        return;
      }
      await daemon.stop();
      daemon = null;
    })
    .command('status', 'Show Hermes daemon status', async () => {
      if (!daemon) {
        console.log('[Hermes] Daemon is not running');
        console.log('  Status: idle');
        console.log('  Hint: run "eve builder hermes start" to begin polling');
        return;
      }
      const s = daemon.stats;
      const status = daemon.status;
      console.log(`[Hermes] Status: ${status}`);
      console.log(`  Tasks completed: ${s.tasksCompleted}`);
      console.log(`  Tasks failed: ${s.tasksFailed}`);
      console.log(`  Total polls: ${s.totalPolls}`);
      console.log(`  Queue size: ${daemon.queueSize}`);
      console.log(`  Started: ${s.startTime}`);
      if (s.lastPoll) console.log(`  Last poll: ${s.lastPoll}`);
      if (s.lastTaskId) console.log(`  Last task: ${s.lastTaskId}`);
    })
    .command('poll', 'Trigger a single poll cycle (one-shot)', async () => {
      if (!daemon) {
        console.log('[Hermes] Daemon is not running — starting single-shot mode');
        daemon = new HermesDaemon();
        await daemon.start();
      }
      const count = await daemon.pollOnce();
      console.log(`[Hermes] Polled ${count} task(s)`);
      await daemon.stop();
      daemon = null;
    })
    .command('logs', 'Show recent task logs (simulated — real logs in Synap)', () => {
      console.log('[Hermes] Task logs are submitted to Synap automatically.');
      console.log('  View task results at your Synap dashboard.');
      console.log('  Or use "eve builder hermes poll" to trigger a one-shot run.');
    });
}
