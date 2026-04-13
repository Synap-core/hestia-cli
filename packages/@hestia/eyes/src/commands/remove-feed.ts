import { Command } from 'commander';
import { HestiaEntityManager } from '@hestia/dna';
import { RSSHubService } from '../lib/rsshub.js';

export function removeFeedCommand(program: Command): void {
  program
    .command('eyes:remove-feed')
    .alias('eyes:rm')
    .description('Remove an RSS feed')
    .argument('<name>', 'Name of the feed to remove')
    .action(async (name: string) => {
      try {
        const entityManager = new HestiaEntityManager();
        
        // Check if RSSHub is installed
        const rsshubInstance = await entityManager.findOne({ type: 'rsshub_instance' });
        if (!rsshubInstance) {
          console.error('RSSHub is not installed. Run: hestia eyes:install');
          process.exit(1);
        }

        const rsshub = new RSSHubService(entityManager);
        await rsshub.removeFeed(name);
        
        console.log(`\n✓ Feed "${name}" removed successfully!`);
      } catch (error) {
        console.error('Failed to remove feed:', error);
        process.exit(1);
      }
    });
}
