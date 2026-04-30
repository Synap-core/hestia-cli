import type { Command } from 'commander';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { writeEveSecrets, readEveSecrets, getAccessUrls, getServerIp, entityStateManager } from '@eve/dna';
import { TraefikService } from '@eve/legs';
import { colors, printSuccess, printInfo, printWarning, printError } from '../lib/ui.js';

export function domainCommand(program: Command): void {
  const domain = program
    .command('domain')
    .description('Configure domain access and Traefik routing');

  domain
    .command('set <domain>')
    .description('Set primary domain and configure Traefik subdomains')
    .option('--ssl', "Enable SSL with Let's Encrypt")
    .option('--email <email>', "Email for Let's Encrypt notifications")
    .action(async (domainName: string, opts: { ssl?: boolean; email?: string }) => {
      if (opts.ssl && !opts.email) {
        printWarning("--ssl requires --email <address> for Let's Encrypt certificate provisioning.");
        printWarning("Example: eve domain set " + domainName + " --ssl --email you@example.com");
        process.exit(1);
      }

      await writeEveSecrets({ domain: { primary: domainName, ssl: !!opts.ssl, email: opts.email } });

      // Read installed components so we only wire routes for what's actually installed
      let installedComponents: string[] | undefined;
      try {
        installedComponents = await entityStateManager.getInstalledComponents();
      } catch {
        // First-time run or state not yet initialized — route everything
      }

      try {
        const traefik = new TraefikService();
        await traefik.configureSubdomains(domainName, !!opts.ssl, opts.email, installedComponents);
        printSuccess(`Traefik routes configured for ${domainName}`);
      } catch {
        printInfo('Traefik config could not be written — run this command on your server to apply routes.');
      }

      const secrets = await readEveSecrets(process.cwd());
      const urls = getAccessUrls(secrets, installedComponents);

      console.log();
      console.log(colors.primary.bold('Access URLs:'));
      console.log(colors.muted('─'.repeat(60)));
      for (const svc of urls) {
        if (svc.domainUrl) {
          console.log(`  ${svc.emoji}  ${svc.label.padEnd(20)} ${colors.primary(svc.domainUrl)}`);
        }
      }

      const serverIp = getServerIp();
      const subdomains = urls.filter(u => u.domainUrl).map(u => {
        // Extract subdomain from domainUrl
        const url = u.domainUrl!;
        const host = url.replace(/^https?:\/\//, '').split('/')[0];
        return host.replace(`.${domainName}`, '');
      });

      console.log();
      console.log(colors.primary.bold('DNS records to create:'));
      console.log(colors.muted('─'.repeat(60)));
      console.log(colors.muted(`  Type   Name                        Value`));
      console.log(colors.muted('─'.repeat(60)));
      for (const sub of subdomains) {
        const name = `${sub}.${domainName}`.padEnd(30);
        const value = serverIp ?? colors.warning('<your-server-ip>');
        console.log(`  ${colors.primary('A')}      ${name}  ${value}`);
      }
      console.log(colors.muted('─'.repeat(60)));
      if (!serverIp) {
        printInfo('Could not detect server IP automatically — replace <your-server-ip> above.');
      }
      if (opts.ssl) {
        console.log();
        printInfo('SSL will provision automatically once DNS records propagate (usually 1–5 min).');
      }
      console.log();
      printInfo('Run `eve domain check` to verify Traefik is routing correctly.');
    });

  domain
    .command('show')
    .description('Show all access URLs (local, server IP, domain)')
    .action(async () => {
      const secrets = await readEveSecrets(process.cwd());
      let installedComponents: string[] | undefined;
      try { installedComponents = await entityStateManager.getInstalledComponents(); } catch { /* ignore */ }
      const urls = getAccessUrls(secrets, installedComponents);
      const domainSet = !!secrets?.domain?.primary;

      console.log();
      console.log(colors.primary.bold('Eve — Access URLs'));
      console.log(colors.muted('─'.repeat(70)));

      for (const svc of urls) {
        console.log();
        console.log(`  ${svc.emoji}  ${colors.primary.bold(svc.label)}`);
        console.log(`     ${colors.muted('Local:')}    ${svc.localUrl}`);
        if (svc.serverUrl) console.log(`     ${colors.muted('Server:')}   ${svc.serverUrl}`);
        if (svc.domainUrl) console.log(`     ${colors.muted('Domain:')}   ${colors.primary(svc.domainUrl)}`);
      }

      console.log();
      if (!domainSet) {
        console.log(colors.muted("  Tip: run `eve domain set yourdomain.com --ssl` to configure domain access"));
      }
    });

  domain
    .command('check')
    .description('Verify Traefik is running and routes are reachable')
    .action(async () => {
      const TRAEFIK_CONFIG = '/opt/traefik/traefik.yml';
      const TRAEFIK_DYNAMIC = '/opt/traefik/dynamic/eve-routes.yml';

      console.log();
      console.log(colors.primary.bold('Eve — Domain / Traefik diagnostic'));
      console.log(colors.muted('─'.repeat(60)));
      console.log();

      // 1. Traefik container running?
      let traefikRunning = false;
      try {
        const out = execSync('docker ps --filter "name=eve-legs-traefik" --format "{{.Names}}"', {
          encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'],
        }).trim();
        traefikRunning = out.length > 0;
      } catch { /* docker not available */ }

      const tick = colors.success !== undefined ? colors.success('✓') : '✓';
      const cross = colors.error !== undefined ? colors.error('✗') : '✗';
      const warn = colors.warning !== undefined ? colors.warning('!') : '!';

      console.log(traefikRunning
        ? `  ${tick}  Traefik container:   running (eve-legs-traefik)`
        : `  ${cross}  Traefik container:   NOT running — run: eve install --components=traefik`);

      // 2. Config files present?
      const staticOk = existsSync(TRAEFIK_CONFIG);
      const dynamicOk = existsSync(TRAEFIK_DYNAMIC);
      console.log(staticOk
        ? `  ${tick}  Static config:       ${TRAEFIK_CONFIG}`
        : `  ${cross}  Static config:       MISSING — run: eve domain set <yourdomain>`);
      console.log(dynamicOk
        ? `  ${tick}  Dynamic routes:      ${TRAEFIK_DYNAMIC}`
        : `  ${cross}  Dynamic routes:      MISSING — run: eve domain set <yourdomain>`);

      // 3. Traefik listening on port 80?
      let port80ok = false;
      try {
        execSync('curl -s --max-time 2 http://localhost:80 > /dev/null 2>&1 || exit 0');
        port80ok = true;
      } catch { /* ignore */ }
      try {
        const out = execSync("ss -tlnp 2>/dev/null | grep ':80 ' || netstat -tlnp 2>/dev/null | grep ':80 ' || echo ''", {
          encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'],
        }).trim();
        port80ok = out.length > 0;
      } catch { /* ignore */ }
      console.log(port80ok
        ? `  ${tick}  Port 80:             listening`
        : `  ${warn}  Port 80:             nothing listening (check docker port binding)`);

      // 4. Dynamic routes content
      if (dynamicOk) {
        console.log();
        console.log(colors.muted('  Active routes (from eve-routes.yml):'));
        try {
          const out = execSync(`grep -E "rule:|subdomain:" ${TRAEFIK_DYNAMIC}`, {
            encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'],
          }).trim();
          for (const line of out.split('\n')) {
            console.log(`    ${colors.muted(line.trim())}`);
          }
        } catch {
          console.log(colors.muted('    (could not read routes)'));
        }
      }

      // 5. Recent Traefik logs
      if (traefikRunning) {
        console.log();
        console.log(colors.muted('  Recent Traefik logs (last 15 lines):'));
        try {
          const logs = execSync('docker logs eve-legs-traefik --tail 15 2>&1', {
            encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'],
          }).trim();
          for (const line of logs.split('\n')) {
            const isError = /error|ERR|level=error/i.test(line);
            const isWarn = /warn|WARN|level=warn/i.test(line);
            const colored = isError ? colors.error(line) : isWarn ? colors.warning(line) : colors.muted(line);
            console.log(`    ${colored}`);
          }
        } catch {
          console.log(colors.muted('    (could not read logs)'));
        }
      }

      // 6. Advice
      console.log();
      if (!traefikRunning) {
        printError('Traefik is not running. Start it with: eve install --components=traefik');
      } else if (!dynamicOk) {
        printWarning('No route config found. Run: eve domain set <yourdomain>');
      } else {
        printInfo('If routes show 404, check:');
        printInfo('  1. DNS A records point to this server IP');
        printInfo('  2. Upstream containers are running: docker ps');
        printInfo('  3. Containers share eve-network: docker network inspect eve-network');
      }
      console.log();
    });

  domain
    .command('unset')
    .description('Remove domain configuration')
    .action(async () => {
      const secrets = await readEveSecrets(process.cwd());
      if (secrets?.domain?.primary) {
        await writeEveSecrets({ domain: { primary: undefined, ssl: undefined, email: undefined } });
        printSuccess('Domain configuration removed');
      } else {
        printInfo('No domain configured');
      }
    });
}
