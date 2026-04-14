import { Command } from 'commander';
import { RSSHubService } from '../lib/rsshub.js';

export function listFeedsCommand(program: Command): void {
  program
    .command('list-feeds')
    .alias('eyes:ls')
    .description('List all RSS feeds')
    .action(async () => {
      try {
        console.log('👁️  Eve Eyes - Listing feeds...\n');
        
        const rsshub = new RSSHubService();
        const feeds = await rsshub.listFeeds();
        
        if (feeds.length === 0) {
          console.log('No feeds configured yet.');
          console.log('Add one with: eve eyes:add-feed <name> <url>');
        } else {
          console.log(`Found ${feeds.length} feed(s):\n`);
          feeds.forEach((feed, i) => {
            console.log(`  ${i + 1}. ${feed.name}`);
            console.log(`     URL: ${feed.url}`);
            console.log(`     Status: ${feed.status}\n`);
          });
        }
      } catch (error) {
        console.error('❌ Failed to list feeds:', error);
        process.exit(1);
      }
    });
}
