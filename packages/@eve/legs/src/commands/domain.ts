import { Command } from 'commander';
import { TraefikService } from '../lib/traefik.js';
import { writeEveSecrets, entityStateManager } from '@eve/dna';

/** Register `eve legs domain <subcommand>` (set | status | unset) */
export function domainCommand(program: Command): void {
  const domain = program
    .command('domain')
    .description('Configure Traefik domain and SSL');

  domain
    .command('set <domain>')
    .description('Set primary domain for Traefik routes')
    .option('--ssl', 'Enable SSL with Let\'s Encrypt')
    .option('--email <email>', 'ACME email for SSL certificate')
    .option('--behind-proxy', 'HTTP-only mode: external proxy handles SSL (no port 443, no redirects)')
    .action(async (domainName: string, options: { ssl?: boolean; email?: string; behindProxy?: boolean }) => {
      try {
        const traefik = new TraefikService();

        if (options.behindProxy && options.ssl) {
          console.error('--behind-proxy and --ssl are mutually exclusive. The external proxy handles SSL.');
          process.exit(1);
        }

        let installedComponents: string[] = [];
        try { installedComponents = await entityStateManager.getInstalledComponents(); } catch {}

        console.log(`Configuring domain: ${domainName}`);

        if (options.behindProxy) {
          await traefik.enableProxyMode(domainName, installedComponents);
          await writeEveSecrets(
            { domain: { primary: domainName, ssl: false, behindProxy: true } },
            process.cwd(),
          );
          console.log(`Domain configured: ${domainName} (behind-proxy, HTTP only)`);
          console.log('External proxy must forward port 80 and handle SSL termination.');
        } else {
          await traefik.configureSubdomains(domainName, !!options.ssl, options.email, installedComponents, false);
          await writeEveSecrets(
            { domain: { primary: domainName, ssl: !!options.ssl, email: options.email, behindProxy: false } },
            process.cwd(),
          );
          const protocol = options.ssl ? 'https' : 'http';
          console.log(`Domain configured: ${domainName}${options.ssl ? ' (SSL)' : ''}`);
          console.log('\nExample endpoints:');
          for (const sub of ['pod', 'dashboard']) {
            console.log(`  ${protocol}://${sub}.${domainName}`);
          }
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
