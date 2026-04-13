import { Command } from 'commander';
import { HestiaEntityManager } from '@hestia/dna';
import { RSSHubService } from './lib/rsshub.js';

// Command exports
export { installCommand } from './commands/install.js';
export { addFeedCommand } from './commands/add-feed.js';
export { listFeedsCommand } from './commands/list-feeds.js';

// Core service exports
export { RSSHubService } from './lib/rsshub.js';
export type { Feed, RSSHubConfig } from './lib/rsshub.js';

/**
 * Register all Eyes commands with the CLI program
 */
export function registerEyesCommands(program: Command): void {
  const { installCommand } = require('./commands/install.js');
  const { addFeedCommand } = require('./commands/add-feed.js');
  const { listFeedsCommand } = require('./commands/list-feeds.js');
  const { removeFeedCommand } = require('./commands/remove-feed.js');
  const { syncCommand } = require('./commands/sync.js');
  const { startCommand } = require('./commands/start.js');
  const { stopCommand } = require('./commands/stop.js');

  installCommand(program);
  addFeedCommand(program);
  listFeedsCommand(program);
  removeFeedCommand(program);
  syncCommand(program);
  startCommand(program);
  stopCommand(program);
}

/**
 * Create an RSSHub service instance
 */
export function createRSSHubService(
  entityManager?: HestiaEntityManager,
  config?: ConstructorParameters<typeof RSSHubService>[1]
): RSSHubService {
  const em = entityManager ?? new HestiaEntityManager();
  return new RSSHubService(em, config);
}
