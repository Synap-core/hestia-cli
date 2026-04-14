import type { Command } from 'commander';
import { SynapService } from './lib/synap.js';
import { initCommand } from './commands/init.js';
import { statusCommand } from './commands/status.js';

// Services
export { SynapService, type SynapHealth } from './lib/synap.js';
export { resolveSynapDelegate, type SynapDelegatePaths } from './lib/synap-delegate.js';
export { execa } from './lib/exec.js';
export { OllamaService, type AIModelStatus } from './lib/ollama.js';
export { PostgresService } from './lib/postgres.js';
export { RedisService } from './lib/redis.js';

// Commands (re-export for advanced use)
export { initCommand, runBrainInit, type BrainInitOptions } from './commands/init.js';
export { runInferenceInit, type InferenceInitOptions } from './inference-init.js';
export { statusCommand } from './commands/status.js';

/** Register leaf commands on an existing `eve brain` Commander node */
export function registerBrainCommands(brain: Command): void {
  initCommand(brain);
  statusCommand(brain);

  brain
    .command('start')
    .description('Start Synap backend container')
    .action(async () => {
      const synap = new SynapService();
      await synap.start();
    });

  brain
    .command('stop')
    .description('Stop Synap backend container')
    .action(async () => {
      const synap = new SynapService();
      await synap.stop();
    });
}
