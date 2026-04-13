import { Command } from 'commander';
import { openclaw } from '../lib/openclaw.js';

export function stopCommand(program: Command): void {
  program
    .command('stop')
    .description('Stop OpenClaw AI assistant')
    .action(async () => {
      try {
        console.log('🛑 Stopping OpenClaw...\n');

        await openclaw.stop();

        console.log('\n✅ OpenClaw stopped');
      } catch (error) {
        console.error('❌ Failed to stop OpenClaw:', error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });
}
