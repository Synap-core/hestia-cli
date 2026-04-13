import { Command } from 'commander';
import { TraefikService } from '../lib/traefik.js';
import { TunnelService } from '../lib/tunnel.js';

export function setupCommand(program: Command): void {
  program
    .command('legs setup')
    .description('Setup Traefik reverse proxy for Hestia')
    .option('--domain <domain>', 'Custom domain for external access')
    .option('--tunnel <provider>', 'Tunnel provider (pangolin, cloudflare)')
    .option('--tunnel-domain <domain>', 'Domain for tunnel (if using tunnel)')
    .option('--ssl', 'Enable SSL/TLS (requires --domain)')
    .option('--standalone', 'Install standalone Traefik (not using Dokploy)')
    .action(async (options) => {
      try {
        console.log('🦵 Setting up Legs (Traefik reverse proxy)...\n');

        const traefik = options.standalone
          ? new TraefikService('/opt/hestia/traefik')
          : new TraefikService();

        // 1. Install Traefik (or use Dokploy's)
        console.log('Step 1: Installing Traefik...');
        await traefik.install();

        // 2. Configure routes to all organs
        console.log('\nStep 2: Configuring routes...');

        // Default organ routes
        const organs = [
          { name: 'brain', path: '/brain', port: 3000 },
          { name: 'heart', path: '/heart', port: 4000 },
          { name: 'memory', path: '/memory', port: 5432 },
          { name: 'nerves', path: '/nerves', port: 6379 },
          { name: 'eyes', path: '/eyes', port: 8080 },
          { name: 'dna', path: '/dna', port: 9000 }
        ];

        for (const organ of organs) {
          const target = `http://localhost:${organ.port}`;
          await traefik.addRoute(organ.path, target, {
            domain: options.domain,
            ssl: false // SSL will be enabled separately if needed
          });
          console.log(`  ✓ Route: ${organ.path} -> ${target}`);
        }

        // 3. Setup tunnel if requested
        if (options.tunnel) {
          console.log(`\nStep 3: Setting up ${options.tunnel} tunnel...`);
          const tunnel = new TunnelService();

          if (options.tunnel === 'pangolin') {
            await tunnel.setupPangolin({ domain: options.tunnelDomain });
            console.log('  ✓ Pangolin tunnel configured');
          } else if (options.tunnel === 'cloudflare') {
            await tunnel.setupCloudflare({
              tunnelName: 'hestia-tunnel',
              domain: options.tunnelDomain
            });
            console.log('  ✓ Cloudflare tunnel configured');
          } else {
            console.warn(`  ⚠ Unknown tunnel provider: ${options.tunnel}`);
          }
        }

        // 4. Configure domain if provided
        if (options.domain) {
          console.log(`\nStep 4: Configuring domain ${options.domain}...`);
          await traefik.configureDomain(options.domain);
          console.log(`  ✓ Domain configured`);

          // 5. Enable SSL if requested
          if (options.ssl) {
            console.log('\nStep 5: Enabling SSL...');
            await traefik.enableSSL();
            console.log('  ✓ SSL enabled with Let\'s Encrypt');
          }
        }

        // 6. Start Traefik
        console.log('\nStep 6: Starting Traefik...');
        await traefik.start();

        console.log('\n✅ Legs setup complete!');
        console.log('\nYour organs are now accessible at:');
        const baseUrl = options.domain || 'localhost';
        const protocol = options.ssl ? 'https' : 'http';
        for (const organ of organs) {
          console.log(`  ${protocol}://${baseUrl}${organ.path}`);
        }

        if (options.tunnel) {
          console.log(`\nTunnel configured with ${options.tunnel}`);
          if (options.tunnelDomain) {
            console.log(`External domain: ${options.tunnelDomain}`);
          }
        }

      } catch (error) {
        console.error('\n❌ Setup failed:', error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });
}
