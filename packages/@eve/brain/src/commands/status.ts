import type { Command } from 'commander';

import { SynapService } from '../lib/synap.js';
import { PostgresService } from '../lib/postgres.js';
import { RedisService } from '../lib/redis.js';
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
        if (delegate) {
          await execa('bash', [delegate.synapScript, 'health'], {
            cwd: delegate.repoRoot,
            env: { ...process.env, SYNAP_DEPLOY_DIR: delegate.deployDir },
            stdio: 'inherit',
          });
          const ollama = new OllamaService();
          const ollamaStatus = await ollama.getStatus();
          if (ollamaStatus.running) {
            console.log('\nOllama (sidecar)');
            if (ollamaStatus.modelsInstalled.length > 0) {
              for (const model of ollamaStatus.modelsInstalled) {
                const current = model === ollamaStatus.currentModel ? ' (current)' : '';
                console.log(`  • ${model}${current}`);
              }
            }
          }
          return;
        }

        const synap = new SynapService();
        const postgres = new PostgresService();
        const redis = new RedisService();
        const ollama = new OllamaService();

        // Check all services
        const synapHealthy = await synap.isHealthy();
        const postgresHealthy = await postgres.isHealthy();
        const redisHealthy = await redis.isHealthy();
        const ollamaStatus = await ollama.getStatus();

        // Display status table
        console.log('Brain Status');
        
        const services = [
          { name: 'Synap Backend', healthy: synapHealthy, url: 'http://localhost:4000' },
          { name: 'PostgreSQL', healthy: postgresHealthy, url: 'localhost:5432' },
          { name: 'Redis', healthy: redisHealthy, url: 'localhost:6379' },
          { name: 'Ollama', healthy: ollamaStatus.running, url: 'http://localhost:11434' }
        ];

        for (const service of services) {
          const mark = service.healthy ? '✓' : '✗';
          console.log(`  ${mark} ${service.name.padEnd(20)} ${service.url}`);
        }

        // Show Ollama details if running
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

        // Overall health
        const allHealthy = synapHealthy && postgresHealthy && redisHealthy;
        console.log('Summary');
        if (allHealthy) {
          console.log('All core services are healthy!');
        } else {
          console.warn('Some services are unhealthy. Run "eve brain init" to fix.');
        }
      } catch (error) {
        console.error('Failed to check brain status:', error);
        process.exit(1);
      }
    });
}
