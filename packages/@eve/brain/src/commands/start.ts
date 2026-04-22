import type { Command } from 'commander';
import { SynapService } from '../lib/synap.js';

export function startCommand(program: Command): void {
  program
    .command('start')
    .description('Start Synap backend container')
    .action(async () => {
      const synap = new SynapService();
      await synap.start();
    });
}
