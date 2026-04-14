import { Command } from 'commander';
import { RSSHubService } from '../lib/rsshub.js';

export function syncCommand(program: Command): void {
  program
    .command('sync')
    .description('Sync RSS feeds to Brain')
    .action(async () => {
      try {
        console.log('👁️  Syncing feeds to Brain...\n');
        const rsshub = new RSSHubService();
        await rsshub.syncToBrain();
        console.log('\n✅ Feeds synced successfully!');
      } catch (error) {
        console.error('❌ Failed to sync:', error);
        process.exit(1);
      }
    });
}
