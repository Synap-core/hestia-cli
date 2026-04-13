import { Command } from 'commander';
import { HestiaEntityManager } from '@hestia/dna';
import { RSSHubService } from '../lib/rsshub.js';

export function listFeedsCommand(program: Command): void {
  program
    .command('eyes:list-feeds')
    .alias('eyes:ls')
    .description('List all configured RSS feeds')
    .option('-a, --all', 'Show all details including URLs')
    .action(async (options) => {
      try {
        const entityManager = new HestiaEntityManager();
        
        // Check if RSSHub is installed
        const rsshubInstance = await entityManager.findOne({ type: 'rsshub_instance' });
        if (!rsshubInstance) {
          console.error('RSSHub is not installed. Run: hestia eyes:install');
          process.exit(1);
        }

        const rsshub = new RSSHubService(entityManager);
        const feeds = await rsshub.listFeeds();

        if (feeds.length === 0) {
          console.log('No feeds configured.');
          console.log('Add a feed with: hestia eyes:add-feed <name> <url>');
          return;
        }

        console.log(`\nConfigured Feeds (${feeds.length}):\n`);

        for (const feed of feeds) {
          const statusIcon = feed.status === 'active' ? '✓' : 
                            feed.status === 'error' ? '✗' : '⏸';
          const lastFetch = feed.lastFetch 
            ? new Date(feed.lastFetch).toLocaleString()
            : 'Never';

          console.log(`${statusIcon} ${feed.name}`);
          console.log(`   Status: ${feed.status}`);
          console.log(`   Last fetch: ${lastFetch}`);
          
          if (options.all) {
            console.log(`   URL: ${feed.url}`);
          }
          
          console.log('');
        }

        console.log('Commands:');
        console.log('  hestia eyes:add-feed <name> <url>  - Add a new feed');
        console.log('  hestia eyes:remove-feed <name>     - Remove a feed');
        console.log('  hestia eyes:sync                   - Sync feeds to Brain');
      } catch (error) {
        console.error('Failed to list feeds:', error);
        process.exit(1);
      }
    });
}
