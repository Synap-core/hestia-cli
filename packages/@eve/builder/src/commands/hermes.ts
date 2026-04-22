import { HermesDaemon, type HermesConfig } from '../lib/hermes-daemon';

let daemon: HermesDaemon | null = null;

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
      const config: Record<string, unknown> = {};

      if (argv.pollInterval != null) config.pollIntervalMs = argv.pollInterval;
      if (argv.maxConcurrent != null) config.maxConcurrentTasks = argv.maxConcurrent;
      if (argv.apiUrl != null) config.apiUrl = argv.apiUrl;
      if (argv.apiKey != null) config.apiKey = argv.apiKey;
      if (argv.workspace != null) config.workspaceDir = argv.workspace;

      daemon = new HermesDaemon(config as Partial<HermesConfig>);

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
