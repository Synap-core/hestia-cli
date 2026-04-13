import { Command } from 'commander';
import { openclaw } from '../lib/openclaw.js';

export function startCommand(program: Command): void {
  program
    .command('start')
    .description('Start OpenClaw AI assistant')
    .action(async () => {
      try {
        console.log('🚀 Starting OpenClaw...\n');

        await openclaw.start();

        const status = await openclaw.getStatus();
        console.log('\n🎉 OpenClaw is ready!');
        console.log(`   URL: ${status.url}`);
        console.log(`   Model: ${status.model}`);
      } catch (error) {
        console.error('❌ Failed to start OpenClaw:', error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });
}
