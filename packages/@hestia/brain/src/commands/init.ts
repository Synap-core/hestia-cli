import type { Command } from 'commander';
import { logger, entityStore } from '@hestia/dna';
import { SynapService } from '../lib/synap.js';
import { PostgresService } from '../lib/postgres.js';
import { RedisService } from '../lib/redis.js';
import { OllamaService } from '../lib/ollama.js';

interface InitOptions {
  withAi?: boolean;
  model?: string;
}

export function initCommand(program: Command): void {
  program
    .command('brain init')
    .description('Initialize Hestia brain')
    .option('--with-ai', 'Include Ollama for local AI')
    .option('--model <model>', 'AI model to use', 'llama3.1:8b')
    .action(async (options: InitOptions) => {
      try {
        logger.info('Initializing Hestia brain...\n');

        const synap = new SynapService();
        const postgres = new PostgresService();
        const redis = new RedisService();
        const ollama = new OllamaService();

        // Ensure Docker network exists
        await ensureNetwork();

        // 1. Install Synap
        logger.section('Synap Backend');
        await synap.install();
        await synap.start();

        // 2. Install PostgreSQL + Redis
        logger.section('Data Stores');
        await postgres.install();
        await postgres.start();
        
        await redis.install();
        await redis.start();

        // 3. If --with-ai, install Ollama and pull model
        if (options.withAi) {
          logger.section('AI Services');
          await ollama.install();
          await ollama.start();
          await ollama.pullModel(options.model);
        }

        // 4. Update entity state
        await entityStore.update('brain', {
          status: 'initialized',
          synap: { installed: true, running: true },
          postgres: { installed: true, running: true },
          redis: { installed: true, running: true },
          ollama: options.withAi ? { 
            installed: true, 
            running: true,
            model: options.model 
          } : undefined,
          initializedAt: new Date().toISOString()
        });

        logger.success('\nHestia brain initialized successfully!');
        logger.info('\nServices:');
        logger.info('  Synap Backend: http://localhost:4000');
        logger.info('  PostgreSQL: localhost:5432');
        logger.info('  Redis: localhost:6379');
        if (options.withAi) {
          logger.info('  Ollama: http://localhost:11434');
          logger.info(`  Model: ${options.model}`);
        }
      } catch (error) {
        logger.error('Failed to initialize brain:', error);
        process.exit(1);
      }
    });
}

async function ensureNetwork(): Promise<void> {
  try {
    const { execa } = await import('execa');
    const { stdout } = await execa('docker', ['network', 'ls', '--format', '{{.Name}}']);
    
    if (!stdout.includes('hestia-network')) {
      logger.info('Creating hestia-network...');
      await execa('docker', ['network', 'create', 'hestia-network']);
    }
  } catch (error) {
    logger.warn('Could not ensure network:', error);
  }
}
