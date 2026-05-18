/**
 * Hermes CLI commands.
 *
 * The daemon no longer runs from the CLI — it is managed by Docker
 * (`eve-brain-hermes` container). Only the `status` command is retained
 * to give operators a quick hint about where to look for logs.
 */

export function registerHermesCommands(yargs: any) {
  return yargs
    .command('status', 'Show Hermes daemon status', () => {}, () => {
      console.log('[Hermes] Hermes is managed by Docker.');
      console.log('  Use `docker logs eve-brain-hermes` to view logs.');
    });
}
