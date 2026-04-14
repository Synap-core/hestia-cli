import { Command } from 'commander';
import { TraefikService } from '../lib/traefik.js';

/** Register `eve legs domain <subcommand>` (set | status | unset) */
export function domainCommand(program: Command): void {
  const domain = program
    .command('domain')
    .description('Configure Traefik domain and SSL');

  domain
    .command('set <domain>')
    .description('Set primary domain for Traefik routes')
    .option('--ssl', 'Enable SSL with Let\'s Encrypt')
    .action(async (domainName: string, options: { ssl?: boolean }) => {
      try {
        const traefik = new TraefikService();

        console.log(`Configuring domain: ${domainName}`);
        await traefik.configureDomain(domainName);
        console.log(`Domain configured: ${domainName}`);

        if (options.ssl) {
          console.log('Enabling SSL with Let\'s Encrypt...');
          await traefik.enableSSL();
          console.log('SSL enabled');
        }

        const protocol = options.ssl ? 'https' : 'http';
        console.log('\nEndpoints (example paths):');
        for (const path of ['/brain', '/api']) {
          console.log(`  ${protocol}://${domainName}${path}`);
        }
      } catch (error) {
        console.error('Domain configuration failed:', error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  domain
    .command('unset')
    .description('Revert domain to localhost')
    .action(async () => {
      try {
        const traefik = new TraefikService();
        await traefik.configureDomain('localhost');
        console.log('Domain configuration removed (localhost)');
      } catch (error) {
        console.error('Failed to unset domain:', error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  domain
    .command('status')
    .description('Show current domain and route configuration')
    .action(async () => {
      try {
        const traefik = new TraefikService();
        const status = await traefik.getStatus();

        console.log('Legs (Traefik) configuration:\n');
        const state = status.installed
          ? status.running
            ? 'running'
            : 'installed (not running)'
          : 'not installed';
        console.log(`Status: ${state}`);
        console.log(`Domain: ${status.domain || 'localhost'}`);
        console.log(`SSL: ${status.ssl ? 'enabled' : 'disabled'}`);
        console.log(`\nRoutes (${status.routes.length}):`);

        for (const route of status.routes) {
          console.log(`  ${route.path} -> ${route.target}`);
        }
      } catch (error) {
        console.error('Failed to get status:', error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });
}
