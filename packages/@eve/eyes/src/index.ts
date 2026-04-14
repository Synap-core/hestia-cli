import { Command } from 'commander';

// Import all command modules
import { installCommand } from './commands/install.js';
import { addFeedCommand } from './commands/add-feed.js';
import { listFeedsCommand } from './commands/list-feeds.js';
import { removeFeedCommand } from './commands/remove-feed.js';
import { startCommand } from './commands/start.js';
import { stopCommand } from './commands/stop.js';
import { syncCommand } from './commands/sync.js';
import { databaseCommand } from './commands/database.js';

// Re-export commands
export { 
  installCommand,
  addFeedCommand,
  listFeedsCommand,
  removeFeedCommand,
  startCommand,
  stopCommand,
  syncCommand,
  databaseCommand,
};

// Core service exports
export { RSSHubService } from './lib/rsshub.js';
export type { Feed, RSSHubConfig } from './lib/rsshub.js';

/**
 * Register Eyes leaf commands on an existing `eve eyes` Commander node
 */
export function registerEyesCommands(eyes: Command): void {
  installCommand(eyes);
  addFeedCommand(eyes);
  listFeedsCommand(eyes);
  removeFeedCommand(eyes);
  startCommand(eyes);
  stopCommand(eyes);
  syncCommand(eyes);
  databaseCommand(eyes);
}

/**
 * Create an RSSHub service instance
 */
export function createRSSHubService(
  config?: ConstructorParameters<typeof import('./lib/rsshub.js').RSSHubService>[0]
): import('./lib/rsshub.js').RSSHubService {
  const { RSSHubService } = require('./lib/rsshub.js');
  return new RSSHubService(config);
}
