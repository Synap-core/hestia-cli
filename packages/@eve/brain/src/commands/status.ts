import type { Command } from 'commander';

import { OllamaService } from '../lib/ollama.js';
import { resolveSynapDelegate } from '../lib/synap-delegate.js';
import { execa } from '../lib/exec.js';

export function statusCommand(program: Command): void {
  program
    .command('status')
    .description('Show brain health status')
    .action(async () => {
      try {
        console.log('Checking brain health...\n');

        const delegate = resolveSynapDelegate();
        if (!delegate) {
          throw new Error(
            'Synap delegate not configured. Set SYNAP_REPO_ROOT to a valid synap-backend checkout and rerun `eve brain status`.',
          );
        }

        await execa('bash', [delegate.synapScript, 'health'], {
          cwd: delegate.repoRoot,
          env: { ...process.env, SYNAP_DEPLOY_DIR: delegate.deployDir },
          stdio: 'inherit',
        });

        const ollama = new OllamaService();
        const ollamaStatus = await ollama.getStatus();
        if (ollamaStatus.running) {
          console.log('AI Models');
          if (ollamaStatus.modelsInstalled.length > 0) {
            for (const model of ollamaStatus.modelsInstalled) {
              const current = model === ollamaStatus.currentModel ? ' (current)' : '';
              console.log(`  • ${model}${current}`);
            }
          } else {
            console.log('  No models installed');
            console.log('  Run: eve brain init --with-ai --model <model>');
          }
        }
      } catch (error) {
        console.error('Failed to check brain status:', error);
        process.exit(1);
      }
    });
}
