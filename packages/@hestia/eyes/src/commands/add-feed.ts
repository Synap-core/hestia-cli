import { Command } from 'commander';
import { HestiaEntityManager } from '@hestia/dna';
import { RSSHubService } from '../lib/rsshub.js';

export function addFeedCommand(program: Command): void {
  program
    .command('eyes:add-feed')
    .description('Add an RSS feed to monitor')
    .argument('<name>', 'Name for the feed')
    .argument('<url>', 'RSS feed URL or RSSHub route')
    .action(async (name: string, url: string) => {
      try {
        const entityManager = new HestiaEntityManager();
        
        // Check if RSSHub is installed
        const rsshubInstance = await entityManager.findOne({ type: 'rsshub_instance' });
        if (!rsshubInstance) {
          console.error('RSSHub is not installed. Run: hestia eyes:install');
          process.exit(1);
        }

        const rsshub = new RSSHubService(entityManager);

        // Validate URL format
        if (!url.startsWith('/') && !url.startsWith('http')) {
          console.error('Invalid URL. Must be a full URL or RSSHub route starting with /');
          process.exit(1);
        }

        // Convert full URLs to RSSHub route format if needed
        const feedUrl = url.startsWith('http') 
          ? `/rsshub/routes/all/${encodeURIComponent(url)}`
          : url;

        await rsshub.addFeed(name, feedUrl);
        
        console.log(`\n✓ Feed "${name}" added successfully!`);
        console.log(`\nFeed URL: ${feedUrl}`);
        console.log('\nYou can now:');
        console.log('  - List feeds: hestia eyes:list-feeds');
        console.log('  - Sync to Brain: hestia eyes:sync');
      } catch (error) {
        console.error('Failed to add feed:', error);
        process.exit(1);
      }
    });
}
