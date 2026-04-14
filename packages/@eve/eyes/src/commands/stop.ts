import { Command } from 'commander';
import { RSSHubService } from '../lib/rsshub.js';

export function stopCommand(program: Command): void {
  program
    .command('stop')
    .description('Stop RSSHub service')
    .action(async () => {
      try {
        console.log('👁️  Stopping RSSHub...\n');
        const rsshub = new RSSHubService();
        await rsshub.stop();
        console.log('\n✅ RSSHub stopped successfully!');
      } catch (error) {
        console.error('❌ Failed to stop:', error);
        process.exit(1);
      }
    });
}
