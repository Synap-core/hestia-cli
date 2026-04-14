import { TraefikService } from './traefik.js';
import { TunnelService } from './tunnel.js';

export type LegsProxySetupOptions = {
  domain?: string;
  tunnel?: 'pangolin' | 'cloudflare';
  tunnelDomain?: string;
  ssl?: boolean;
  /** Use /opt/eve/traefik instead of Dokploy-managed Traefik */
  standalone?: boolean;
};

/**
 * Programmatic entry for `eve legs setup` — Traefik routes + optional Pangolin/Cloudflare tunnel.
 */
export async function runLegsProxySetup(options: LegsProxySetupOptions): Promise<void> {
  console.log('🦵 Setting up Legs (Traefik reverse proxy)...\n');

  const traefik = options.standalone
    ? new TraefikService('/opt/eve/traefik')
    : new TraefikService();

  console.log('Step 1: Installing Traefik...');
  await traefik.install();

  console.log('\nStep 2: Configuring routes...');

  const organs = [
    { name: 'brain', path: '/brain', port: 3000 },
    { name: 'heart', path: '/heart', port: 4000 },
    { name: 'memory', path: '/memory', port: 5432 },
    { name: 'nerves', path: '/nerves', port: 6379 },
    { name: 'eyes', path: '/eyes', port: 8080 },
    { name: 'dna', path: '/dna', port: 9000 },
  ];

  for (const organ of organs) {
    const target = `http://localhost:${organ.port}`;
    await traefik.addRoute({
      path: organ.path,
      target,
      domain: options.domain,
      ssl: false,
    });
    console.log(`  ✓ Route: ${organ.path} -> ${target}`);
  }

  if (options.tunnel) {
    console.log(`\nStep 3: Setting up ${options.tunnel} tunnel...`);
    const tunnel = new TunnelService();

    if (options.tunnel === 'pangolin') {
      await tunnel.setupPangolin({ domain: options.tunnelDomain });
      console.log('  ✓ Pangolin tunnel configured');
    } else if (options.tunnel === 'cloudflare') {
      await tunnel.setupCloudflare({ domain: options.tunnelDomain });
      console.log('  ✓ Cloudflare tunnel configured');
    } else {
      console.warn(`  ⚠ Unknown tunnel provider: ${options.tunnel}`);
    }
  }

  if (options.domain) {
    console.log(`\nStep 4: Configuring domain ${options.domain}...`);
    await traefik.configureDomain(options.domain);
    console.log('  ✓ Domain configured');

    if (options.ssl) {
      console.log('\nStep 5: Enabling SSL...');
      await traefik.enableSSL();
      console.log("  ✓ SSL enabled with Let's Encrypt");
    }
  }

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
}
