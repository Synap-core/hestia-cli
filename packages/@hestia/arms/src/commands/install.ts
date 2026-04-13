import { Command } from 'commander';
import { brain } from '@hestia/dna';
import { openclaw } from '../lib/openclaw.js';

export function installCommand(program: Command): void {
  program
    .command('install')
    .description('Install OpenClaw AI assistant')
    .action(async () => {
      try {
        console.log('🦾 Hestia Arms - Installing OpenClaw...\n');

        // 1. Check if Brain is ready
        const brainStatus = await brain.getStatus();
        if (!brainStatus.ready) {
          console.error('❌ Brain is not ready. Please run "hestia brain install" first.');
          process.exit(1);
        }
        console.log('✅ Brain is ready');

        // 2. Check if Ollama is installed
        const ollamaRunning = await brain.isOllamaRunning();
        if (!ollamaRunning) {
          console.error('❌ Ollama is not running. Please start Brain first.');
          process.exit(1);
        }
        console.log('✅ Ollama is running');

        // 3. Install OpenClaw
        await openclaw.install();

        // 4. Configure to use Ollama
        await openclaw.configure('http://brain:11434');

        // 5. Start OpenClaw
        await openclaw.start();

        // 6. Update entity state (mark as installed)
        await brain.updateEntityState('arms', {
          installed: true,
          version: '0.1.0',
          openclawUrl: 'http://localhost:3000',
        });

        console.log('\n🎉 OpenClaw installed successfully!');
        console.log('   Access it at: http://localhost:3000');
        console.log('\n   Next steps:');
        console.log('   - hestia arms mcp list        # List MCP servers');
        console.log('   - hestia arms mcp install     # Install an MCP server');
      } catch (error) {
        console.error('❌ Installation failed:', error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });
}
