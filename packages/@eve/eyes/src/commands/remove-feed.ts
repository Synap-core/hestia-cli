import { Command } from 'commander';
import { RSSHubService } from '../lib/rsshub.js';

export function removeFeedCommand(program: Command): void {
  program
    .command('remove-feed <name>')
    .alias('eyes:rm')
    .description('Remove an RSS feed')
    .action(async (name: string) => {
      try {
        console.log(`👁️  Removing feed: ${name}\n`);
        const rsshub = new RSSHubService();
        await rsshub.removeFeed(name);
        console.log(`\n✅ Feed "${name}" removed successfully!`);
      } catch (error) {
        console.error('❌ Failed to remove feed:', error);
        process.exit(1);
      }
    });
}
