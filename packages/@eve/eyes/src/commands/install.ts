import { Command } from 'commander';
import { EntityStateManager } from '@eve/dna';
import { RSSHubService } from '../lib/rsshub.js';

export function installCommand(program: Command): void {
  program
    .command('install')
    .description('Install RSSHub for RSS aggregation')
    .option('-p, --port <port>', 'RSSHub port', '1200')
    .action(async (options) => {
      try {
        console.log('👁️  Eve Eyes - Installing RSSHub...\n');

        const rsshub = new RSSHubService();
        
        // Check if already installed
        const isInstalled = await rsshub.isInstalled();
        if (isInstalled) {
          console.log('✅ RSSHub is already installed');
          console.log('   Use "eve eyes:start" to start it\n');
          return;
        }

        // Install RSSHub
        console.log('📦 Installing RSSHub...');
        await rsshub.install({
          port: parseInt(options.port, 10),
        });

        // Update entity state
        const stateManager = new EntityStateManager();
        await stateManager.updateOrgan('eyes', 'ready');

        console.log('\n✅ RSSHub installed successfully!');
        console.log(`   URL: http://localhost:${options.port}`);
        console.log('   Use "eve eyes:start" to start it\n');

      } catch (error) {
        console.error('❌ Installation failed:', error);
        process.exit(1);
      }
    });
}
