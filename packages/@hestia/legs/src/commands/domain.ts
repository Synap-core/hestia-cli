import { Command } from 'commander';
import { TraefikService } from '../lib/traefik.js';

export function domainCommand(program: Command): void {
  program
    .command('legs domain')
    .description('Configure domain for Traefik reverse proxy')
    .argument('<domain>', 'Domain to configure (e.g., hestia.example.com)')
    .option('--ssl', 'Enable SSL with Let\'s Encrypt')
    .option('--remove', 'Remove domain configuration')
    .action(async (domain: string, options) => {
      try {
        const traefik = new TraefikService();

        if (options.remove) {
          console.log(`Removing domain configuration...`);
          // Revert to localhost
          await traefik.configureDomain('localhost');
          console.log('✅ Domain configuration removed');
          return;
        }

        console.log(`Configuring domain: ${domain}`);

        // Configure domain for all routes
        await traefik.configureDomain(domain);
        console.log(`✅ Domain configured: ${domain}`);

        // Enable SSL if requested
        if (options.ssl) {
          console.log('Enabling SSL with Let\'s Encrypt...');
          await traefik.enableSSL();
          console.log('✅ SSL enabled');
        }

        console.log('\nYour endpoints are now available at:');
        const protocol = options.ssl ? 'https' : 'http';
        const organs = ['brain', 'heart', 'memory', 'nerves', 'eyes', 'dna'];
        for (const organ of organs) {
          console.log(`  ${protocol}://${domain}/${organ}`);
        }

      } catch (error) {
        console.error('❌ Domain configuration failed:', error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  program
    .command('legs domain:status')
    .description('Show current domain configuration')
    .action(async () => {
      try {
        const traefik = new TraefikService();
        const status = await traefik.getStatus();

        console.log('Current Legs Configuration:\n');
        console.log(`Status: ${status.status}`);
        console.log(`Domain: ${status.domain || 'localhost'}`);
        console.log(`SSL: ${status.ssl ? 'enabled' : 'disabled'}`);
        console.log(`\nRoutes (${status.routes.length}):`);

        for (const route of status.routes) {
          console.log(`  ${route.path} -> ${route.target}`);
        }

      } catch (error) {
        console.error('❌ Failed to get status:', error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });
}
