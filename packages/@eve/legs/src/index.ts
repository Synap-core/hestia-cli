import { Command } from 'commander';
import { setupCommand } from './commands/setup.js';
import { domainCommand } from './commands/domain.js';

// Export services
export { TraefikService, Route } from './lib/traefik.js';
export { InferenceGateway, type InferenceGatewayResult } from './lib/inference-gateway.js';
export { TunnelService, TunnelConfig } from './lib/tunnel.js';
export { runLegsProxySetup, type LegsProxySetupOptions } from './lib/run-proxy-setup.js';

// Export commands
export { setupCommand } from './commands/setup.js';
export { domainCommand } from './commands/domain.js';

/** Register Legs leaf commands on an existing `eve legs` Commander node */
export function registerLegsCommands(legs: Command): void {
  setupCommand(legs);
  domainCommand(legs);
}

/** @deprecated Use registerLegsCommands on the `legs` subcommand */
export function registerCommands(program: Command): void {
  const legs = program.command('legs').description('Traefik, domains, and tunnels');
  registerLegsCommands(legs);
}

export default {
  registerLegsCommands,
  registerCommands,
};
