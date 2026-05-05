import { Command } from 'commander';
import { TraefikService } from '../lib/traefik.js';
import { readEveSecrets, writeEveSecrets, entityStateManager } from '@eve/dna';

/** Register `eve legs proxy-mode <subcommand>` (enable | disable | status) */
export function proxyModeCommand(program: Command): void {
  const cmd = program
    .command('proxy-mode')
    .description('Run Traefik behind an external SSL-terminating proxy (Caddy, Nginx, etc.)');

  cmd
    .command('enable')
    .description('Switch to behind-proxy mode: HTTP only on port 80, no SSL/redirects')
    .action(async () => {
      try {
        const secrets = await readEveSecrets(process.cwd());
        const domain = secrets?.domain?.primary;
        if (!domain) {
          console.error('No domain configured. Run `eve legs domain set <domain>` first.');
          process.exit(1);
        }

        const status = new TraefikService().getProxyModeStatus();
        if (status.enabled) {
          console.log('Already in behind-proxy mode.');
          printProxyInstructions(domain);
          return;
        }

        let installedComponents: string[] = [];
        try { installedComponents = await entityStateManager.getInstalledComponents(); } catch {}

        console.log(`Enabling behind-proxy mode for domain: ${domain}`);
        const traefik = new TraefikService();
        await traefik.enableProxyMode(domain, installedComponents);

        await writeEveSecrets({ domain: { ...secrets?.domain, behindProxy: true } }, process.cwd());

        console.log('\nBehind-proxy mode enabled.');
        console.log('Traefik now listens on port 80 only (no port 443, no SSL).\n');
        printProxyInstructions(domain);
      } catch (err) {
        console.error('Failed to enable proxy mode:', err instanceof Error ? err.message : err);
        process.exit(1);
      }
    });

  cmd
    .command('disable')
    .description('Restore standalone mode (Traefik handles SSL directly)')
    .option('--ssl', "Re-enable SSL with Let's Encrypt")
    .option('--email <email>', 'ACME email address for SSL certificate')
    .action(async (options: { ssl?: boolean; email?: string }) => {
      try {
        const secrets = await readEveSecrets(process.cwd());
        const domain = secrets?.domain?.primary;
        if (!domain) {
          console.error('No domain configured. Run `eve legs domain set <domain>` first.');
          process.exit(1);
        }

        const status = new TraefikService().getProxyModeStatus();
        if (!status.enabled) {
          console.log('Already in standalone mode (not behind a proxy).');
          return;
        }

        const ssl = options.ssl ?? false;
        const email = options.email ?? secrets?.domain?.email;
        if (ssl && !email) {
          console.error('--email <email> is required when using --ssl.');
          process.exit(1);
        }

        let installedComponents: string[] = [];
        try { installedComponents = await entityStateManager.getInstalledComponents(); } catch {}

        console.log(`Restoring standalone mode for domain: ${domain}`);
        const traefik = new TraefikService();
        await traefik.disableProxyMode(domain, ssl, email, installedComponents);

        await writeEveSecrets(
          { domain: { ...secrets?.domain, ssl, email, behindProxy: false } },
          process.cwd(),
        );

        console.log('\nStandalone mode restored.');
        console.log(`Traefik now listens on ports 80 and 443.`);
        if (ssl) console.log(`SSL certificates will be obtained via Let's Encrypt for ${domain}.`);
      } catch (err) {
        console.error('Failed to disable proxy mode:', err instanceof Error ? err.message : err);
        process.exit(1);
      }
    });

  cmd
    .command('status')
    .description('Show current proxy mode configuration')
    .action(async () => {
      try {
        const traefik = new TraefikService();
        const status = traefik.getProxyModeStatus();
        const secrets = await readEveSecrets(process.cwd());
        const domain = secrets?.domain?.primary ?? '(not set)';

        console.log(`\nTraefik mode:    ${status.enabled ? 'behind-proxy (HTTP only)' : 'standalone (handles SSL)'}`);
        console.log(`Domain:          ${domain}`);
        console.log(`SSL:             ${status.ssl ? 'enabled (Let\'s Encrypt)' : 'disabled'}`);
        console.log(`Entrypoints:     ${status.entrypoints.join(', ')}`);
        console.log(`Port 443:        ${status.enabled ? 'not bound (proxy handles it)' : 'bound'}`);
        if (status.enabled) {
          console.log('\nYour external proxy must:');
          console.log(`  - Terminate SSL for ${domain} and its subdomains`);
          console.log('  - Forward requests to http://<this-server>:80');
          console.log('  - Set X-Forwarded-Proto: https and X-Forwarded-Host headers');
        }
        console.log();
      } catch (err) {
        console.error('Failed to get proxy mode status:', err instanceof Error ? err.message : err);
        process.exit(1);
      }
    });
}

function printProxyInstructions(domain: string): void {
  console.log('Configure your external proxy to:');
  console.log(`  1. Terminate SSL for ${domain} and its subdomains (pod.${domain}, etc.)`);
  console.log('  2. Forward requests to http://<this-server-ip>:80');
  console.log('  3. Pass these headers:');
  console.log('       X-Forwarded-For: <client-ip>');
  console.log('       X-Forwarded-Proto: https');
  console.log(`       X-Forwarded-Host: <subdomain>.${domain}`);
  console.log();
  console.log('Example Caddy config:');
  console.log(`  ${domain}, *.${domain} {`);
  console.log(`    reverse_proxy <this-server-ip>:80 {`);
  console.log(`      header_up X-Forwarded-Host {host}`);
  console.log(`      header_up X-Forwarded-Proto https`);
  console.log(`    }`);
  console.log(`  }`);
  console.log();
}
