import { Command } from 'commander';
import { HestiaEntityManager } from '@hestia/dna';
import { RSSHubService } from '../lib/rsshub.js';

export function syncCommand(program: Command): void {
  program
    .command('eyes:sync')
    .description('Sync RSS feed content to Brain')
    .option('-f, --feed <name>', 'Sync only a specific feed')
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

        // Check if running
        const isRunning = await rsshub.isRunning();
        if (!isRunning) {
          console.error('RSSHub is not running. Start it with: hestia eyes:start');
          process.exit(1);
        }

        console.log('Syncing RSS content to Brain...\n');
        await rsshub.syncToBrain();
        
        console.log('\n✓ Sync completed successfully!');
      } catch (error) {
        console.error('Sync failed:', error);
        process.exit(1);
      }
    });
}
