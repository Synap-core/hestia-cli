import type { Command } from 'commander';
import { logger } from '@hestia/dna';
import { SynapService } from '../lib/synap.js';
import { PostgresService } from '../lib/postgres.js';
import { RedisService } from '../lib/redis.js';
import { OllamaService } from '../lib/ollama.js';

export function statusCommand(program: Command): void {
  program
    .command('brain status')
    .description('Show brain health status')
    .action(async () => {
      try {
        logger.info('Checking brain health...\n');

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
        logger.section('Brain Status');
        
        const services = [
          { name: 'Synap Backend', healthy: synapHealthy, url: 'http://localhost:4000' },
          { name: 'PostgreSQL', healthy: postgresHealthy, url: 'localhost:5432' },
          { name: 'Redis', healthy: redisHealthy, url: 'localhost:6379' },
          { name: 'Ollama', healthy: ollamaStatus.running, url: 'http://localhost:11434' }
        ];

        for (const service of services) {
          const status = service.healthy ? '✓' : '✗';
          const color = service.healthy ? 'green' : 'red';
          logger.info(`  ${status} ${service.name.padEnd(20)} ${service.url}`, { color });
        }

        // Show Ollama details if running
        if (ollamaStatus.running) {
          logger.section('AI Models');
          if (ollamaStatus.modelsInstalled.length > 0) {
            for (const model of ollamaStatus.modelsInstalled) {
              const current = model === ollamaStatus.currentModel ? ' (current)' : '';
              logger.info(`  • ${model}${current}`);
            }
          } else {
            logger.info('  No models installed');
            logger.info('  Run: hestia brain init --with-ai --model <model>');
          }
        }

        // Overall health
        const allHealthy = synapHealthy && postgresHealthy && redisHealthy;
        logger.section('Summary');
        if (allHealthy) {
          logger.success('All core services are healthy!');
        } else {
          logger.warn('Some services are unhealthy. Run "hestia brain init" to fix.');
        }
      } catch (error) {
        logger.error('Failed to check brain status:', error);
        process.exit(1);
      }
    });
}
