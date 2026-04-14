import { Command } from 'commander';
import { RSSHubService } from '../lib/rsshub.js';

export function startCommand(program: Command): void {
  program
    .command('start')
    .description('Start RSSHub service')
    .action(async () => {
      try {
        console.log('👁️  Starting RSSHub...\n');
        const rsshub = new RSSHubService();
        await rsshub.start();
        console.log('\n✅ RSSHub started successfully!');
      } catch (error) {
        console.error('❌ Failed to start:', error);
        process.exit(1);
      }
    });
}
