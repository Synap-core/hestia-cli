import { Command } from 'commander';
import { RSSHubService } from '../lib/rsshub.js';

export function addFeedCommand(program: Command): void {
  program
    .command('add-feed <name> <url>')
    .description('Add an RSS feed to monitor')
    .action(async (name: string, url: string) => {
      try {
        console.log(`👁️  Adding feed: ${name}\n`);

        const rsshub = new RSSHubService();
        await rsshub.addFeed(name, url);

        console.log(`\n✅ Feed "${name}" added successfully!`);
        console.log(`   URL: ${url}`);
        console.log('\nYou can now:');
        console.log('  - List feeds: eve eyes:list-feeds');
        console.log('  - Sync to Brain: eve eyes:sync');
      } catch (error) {
        console.error('❌ Failed to add feed:', error);
        process.exit(1);
      }
    });
}
