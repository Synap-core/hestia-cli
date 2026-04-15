import { Command } from 'commander';
import { execa } from 'execa';
import { printError, printInfo } from '../../lib/ui.js';

export function logsCommand(program: Command): void {
  program
    .command('logs')
    .description('Docker Compose logs for Eve stack (set EVE_COMPOSE_FILE or run from compose directory)')
    .argument('[service]', 'Optional compose service name')
    .option('-f, --follow', 'Follow log output', false)
    .option('-n, --tail <lines>', 'Number of lines', '100')
    .option('--compose-file <path>', 'Path to docker-compose.yml')
    .action(async (service: string | undefined, opts: { follow?: boolean; tail?: string; composeFile?: string }) => {
      const composeFile = opts.composeFile || process.env.EVE_COMPOSE_FILE;
      const args = ['compose'];
      if (composeFile) {
        args.push('-f', composeFile);
      }
      args.push('logs', `--tail=${opts.tail ?? '100'}`);
      if (opts.follow) args.push('-f');
      if (service) args.push(service);

      try {
        printInfo(`docker ${args.join(' ')}`);
        await execa('docker', args, { stdio: 'inherit' });
      } catch (e) {
        printError(
          e instanceof Error
            ? e.message
            : 'docker compose failed. Set EVE_COMPOSE_FILE or use --compose-file.'
        );
        process.exit(1);
      }
    });
}
