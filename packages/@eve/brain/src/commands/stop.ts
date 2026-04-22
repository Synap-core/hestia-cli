import type { Command } from 'commander';
import { SynapService } from '../lib/synap.js';

export function stopCommand(program: Command): void {
  program
    .command('stop')
    .description('Stop Synap backend container')
    .action(async () => {
      const synap = new SynapService();
      await synap.stop();
    });
}
