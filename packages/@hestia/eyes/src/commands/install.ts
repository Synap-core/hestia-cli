import { Command } from 'commander';
import { HestiaEntityManager } from '@hestia/dna';
import { RSSHubService } from '../lib/rsshub.js';

export function installCommand(program: Command): void {
  program
    .command('eyes:install')
    .description('Install RSSHub for RSS aggregation')
    .option('-p, --port <port>', 'RSSHub port', '1200')
    .option('-b, --brain-url <url>', 'Brain API URL', 'http://localhost:3000/api')
    .action(async (options) => {
      try {
        const entityManager = new HestiaEntityManager();
        
        // Check if already installed
        const existing = await entityManager.findOne({ type: 'rsshub_instance' });
        if (existing) {
          console.log('RSSHub is already installed');
          return;
        }

        const rsshub = new RSSHubService(entityManager, {
          port: parseInt(options.port, 10),
          brainApiUrl: options.brainUrl
        });

        // 1. Install RSSHub container
        await rsshub.install();

        // 2. Configure to connect to Brain
        console.log('Configuring Brain connection...');
        await entityManager.create('brain_connection', {
          service: 'rsshub',
          endpoint: options.brainUrl,
          configuredAt: new Date().toISOString()
        });

        // 3. Update entity state
        await entityManager.create('service', {
          name: 'eyes',
          type: 'rss_aggregator',
          status: 'installed',
          version: '0.1.0'
        });

        console.log('\n✓ Eyes (RSSHub) installed successfully!');
        console.log(`\nRSSHub is running at: http://localhost:${options.port}`);
        console.log('Add feeds with: hestia eyes:add-feed <name> <url>');
      } catch (error) {
        console.error('Installation failed:', error);
        process.exit(1);
      }
    });
}
