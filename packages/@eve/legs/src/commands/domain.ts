import { Command } from 'commander';
import { TraefikService } from '../lib/traefik.js';
import { writeEveSecrets, readEveSecrets, entityStateManager, validateBaseDomain } from '@eve/dna';

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

        const domainError = validateBaseDomain(domainName);
        if (domainError) {
          console.error(domainError);
          process.exit(1);
        }

        // Mode inheritance: when neither --ssl nor --behind-proxy is passed,
        // re-use whatever was previously configured. Otherwise a routine
        // `eve domain set <new-domain>` would silently flip an operator out
        // of proxy mode and try to bind port 443 to Traefik again.
        const prior = await readEveSecrets(process.cwd());
        const explicitMode = options.behindProxy === true || options.ssl === true;
        const behindProxy = options.behindProxy === true
          ? true
          : options.ssl === true
            ? false
            : !!prior?.domain?.behindProxy;
        const ssl = behindProxy ? false : (options.ssl === true || (!explicitMode && !!prior?.domain?.ssl));
        const email = options.email ?? prior?.domain?.email;

        let installedComponents: string[] = [];
        try { installedComponents = await entityStateManager.getInstalledComponents(); } catch {}

        const inheritedNote = !explicitMode
          ? ` (inherited mode: ${behindProxy ? 'behind-proxy' : ssl ? 'ssl' : 'plain'})`
          : '';
        console.log(`Configuring domain: ${domainName}${inheritedNote}`);

        if (behindProxy) {
          await traefik.enableProxyMode(domainName, installedComponents);
          await writeEveSecrets(
            { domain: { primary: domainName, ssl: false, behindProxy: true, email } },
            process.cwd(),
          );
          console.log(`Domain configured: ${domainName} (behind-proxy, HTTP only)`);
          console.log('External proxy must forward port 80 and handle SSL termination.');
        } else {
          await traefik.configureSubdomains(domainName, ssl, email, installedComponents, false);
          await writeEveSecrets(
            { domain: { primary: domainName, ssl, email, behindProxy: false } },
            process.cwd(),
          );
          const protocol = ssl ? 'https' : 'http';
          console.log(`Domain configured: ${domainName}${ssl ? ' (SSL)' : ''}`);
          console.log('\nExample endpoints:');
          for (const sub of ['pod', 'pod-admin', 'eve']) {
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
