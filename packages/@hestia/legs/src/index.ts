import { Command } from 'commander';
import { setupCommand } from './commands/setup.js';
import { domainCommand } from './commands/domain.js';

// Export services
export { TraefikService, Route } from './lib/traefik.js';
export { TunnelService, TunnelConfig } from './lib/tunnel.js';

// Export commands
export { setupCommand } from './commands/setup.js';
export { domainCommand } from './commands/domain.js';

// Register all commands
export function registerCommands(program: Command): void {
  setupCommand(program);
  domainCommand(program);
}

// Default export for convenience
export default {
  registerCommands
};
