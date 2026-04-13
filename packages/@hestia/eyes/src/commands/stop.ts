import { Command } from 'commander';
import { HestiaEntityManager } from '@hestia/dna';
import { RSSHubService } from '../lib/rsshub.js';

export function stopCommand(program: Command): void {
  program
    .command('eyes:stop')
    .description('Stop the RSSHub service')
    .action(async () => {
      try {
        const entityManager = new HestiaEntityManager();
        
        // Check if RSSHub is installed
        const rsshubInstance = await entityManager.findOne({ type: 'rsshub_instance' });
        if (!rsshubInstance) {
          console.error('RSSHub is not installed. Run: hestia eyes:install');
          process.exit(1);
        }

        const rsshub = new RSSHubService(entityManager);
        await rsshub.stop();
        
        console.log('\n✓ RSSHub stopped successfully!');
      } catch (error) {
        console.error('Failed to stop RSSHub:', error);
        process.exit(1);
      }
    });
}
