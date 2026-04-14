import { Command } from 'commander';
import { runLegsProxySetup } from '../lib/run-proxy-setup.js';

export function setupCommand(program: Command): void {
  program
    .command('setup')
    .description('Setup Traefik reverse proxy for Eve')
    .option('--domain <domain>', 'Custom domain for external access')
    .option('--tunnel <provider>', 'Tunnel provider (pangolin, cloudflare)')
    .option('--tunnel-domain <domain>', 'Domain for tunnel (if using tunnel)')
    .option('--ssl', 'Enable SSL/TLS (requires --domain)')
    .option('--standalone', 'Install standalone Traefik (not using Dokploy)')
    .action(async (options) => {
      try {
        await runLegsProxySetup({
          domain: options.domain,
          tunnel: options.tunnel,
          tunnelDomain: options.tunnelDomain,
          ssl: Boolean(options.ssl),
          standalone: Boolean(options.standalone),
        });
      } catch (error) {
        console.error('\n❌ Setup failed:', error);
        process.exit(1);
      }
    });
}
