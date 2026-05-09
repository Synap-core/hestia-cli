import type { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { statusCommand } from './commands/status.js';
import { startCommand } from './commands/start.js';
import { stopCommand } from './commands/stop.js';

// Services
export { SynapService, type SynapHealth } from './lib/synap.js';
export { resolveSynapDelegate, type SynapDelegatePaths } from './lib/synap-delegate.js';
export {
  runSynapCli,
  toPodFqdn,
  type SynapCliSubcommand,
  type RunSynapCliOptions,
  type SynapCliResult,
} from './lib/synap-cli-delegate.js';
export { execa, ensureNetwork } from './lib/exec.js';
export { OllamaService, type AIModelStatus } from './lib/ollama.js';
export { ModelService, type ProviderModel, type ProviderModels } from './lib/model-service.js';
export { installSynapFromImage, reconcileEveEnv, type SynapImageInstallOptions, type SynapImageInstallResult } from './lib/synap-image-install.js';

// Commands (re-export for advanced use)
export { initCommand, runBrainInit, type BrainInitOptions } from './commands/init.js';
export { runInferenceInit, type InferenceInitOptions } from './inference-init.js';
export { statusCommand } from './commands/status.js';
export { startCommand } from './commands/start.js';
export { stopCommand } from './commands/stop.js';

/** Register leaf commands on an existing `eve brain` Commander node */
export function registerBrainCommands(brain: Command): void {
  initCommand(brain);
  statusCommand(brain);
  startCommand(brain);
  stopCommand(brain);
}
