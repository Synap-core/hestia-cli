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

      const tick = colors.success('✓');
      const cross = colors.error('✗');
      const warn = colors.warning('!');

      // ─── 1. Traefik container running? ─────────────────────────────────
      let traefikRunning = false;
      try {
        const out = execSync('docker ps --filter "name=eve-legs-traefik" --format "{{.Names}}"', {
          encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'],
        }).trim();
        traefikRunning = out.length > 0;
      } catch { /* docker not available */ }

      console.log(traefikRunning
        ? `  ${tick}  Traefik container:   running (eve-legs-traefik)`
        : `  ${cross}  Traefik container:   NOT running — run: eve install --components=traefik`);

      // ─── 2. Config files present? ──────────────────────────────────────
      const staticOk = existsSync(TRAEFIK_CONFIG);
      const dynamicOk = existsSync(TRAEFIK_DYNAMIC);
      console.log(staticOk ? `  ${tick}  Static config:       ${TRAEFIK_CONFIG}` : `  ${cross}  Static config:       MISSING`);
      console.log(dynamicOk ? `  ${tick}  Dynamic routes:      ${TRAEFIK_DYNAMIC}` : `  ${cross}  Dynamic routes:      MISSING — run: eve domain set <yourdomain>`);

      if (!traefikRunning || !dynamicOk) {
        console.log();
        printError('Cannot continue diagnostic — Traefik or routes missing.');
        return;
      }

      // ─── 3. Read configured domain ─────────────────────────────────────
      const secrets = await readEveSecrets(process.cwd());
      const configuredDomain = secrets?.domain?.primary;
      console.log(configuredDomain
        ? `  ${tick}  Configured domain:   ${configuredDomain}`
        : `  ${warn}  Configured domain:   none — run: eve domain set <yourdomain>`);

      if (!configuredDomain) {
        console.log();
        printWarning('No domain set — nothing to verify.');
        return;
      }

      // ─── 4. Probe each route via curl with proper Host header ──────────
      console.log();
      console.log(colors.primary.bold('  Per-route probe (Host header → Traefik → upstream):'));
      console.log(colors.muted('  ' + '─'.repeat(58)));

      // Re-derive routes from access-urls list, filtered by what's installed
      let installedComponents: string[] | undefined;
      try { installedComponents = await entityStateManager.getInstalledComponents(); } catch { /* ignore */ }
      const urls = getAccessUrls(secrets, installedComponents);

      // Each upstream check needs the corresponding container/port info
      const upstreamMap: Record<string, { container?: string; port?: number; isHost?: boolean }> = {
        eve:       { isHost: true,                port: 7979 },
        pod:       { container: 'synap-backend-backend-1', port: 4000 },
        openclaw:  { container: 'eve-arms-openclaw',       port: 3000 },
        feeds:     { container: 'eve-eyes-rsshub',         port: 1200 },
        ollama:    { container: 'eve-brain-ollama',        port: 11434 },
        openwebui: { container: 'hestia-openwebui',        port: 8080 },
      };

      for (const svc of urls) {
        if (!svc.domainUrl) continue;
        const host = svc.domainUrl.replace(/^https?:\/\//, '').split('/')[0];

        // Probe Traefik with the right Host header
        let httpCode = '???';
        try {
          httpCode = execSync(
            `curl -s -o /dev/null -w "%{http_code}" --max-time 4 -H "Host: ${host}" http://localhost:80/`,
            { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] },
          ).trim();
        } catch { httpCode = 'timeout'; }

        // Check upstream container exists
        const upstream = upstreamMap[svc.id];
        let upstreamState = 'unknown';
        if (upstream) {
          if (upstream.isHost) {
            try {
              const out = execSync(
                `ss -tlnp 2>/dev/null | grep ':${upstream.port} ' || netstat -tlnp 2>/dev/null | grep ':${upstream.port} ' || echo ''`,
                { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] },
              ).trim();
              upstreamState = out.length > 0 ? 'host:listening' : 'host:NOT listening';
            } catch { upstreamState = 'host:check-failed'; }
          } else if (upstream.container) {
            try {
              const out = execSync(
                `docker ps --filter "name=^${upstream.container}$" --format "{{.Names}}"`,
                { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] },
              ).trim();
              upstreamState = out.length > 0 ? `container:${upstream.container}` : `container:MISSING`;
            } catch { upstreamState = 'docker:check-failed'; }
          }
        }

        const statusBadge = httpCode === '200' || httpCode.startsWith('30')
          ? colors.success(`${httpCode} ✓`)
          : httpCode === '502' || httpCode === '503'
            ? colors.warning(`${httpCode} (route OK, upstream down)`)
            : httpCode === '404'
              ? colors.error(`${httpCode} (route not matching!)`)
              : colors.error(httpCode);

        const upstreamBadge = upstreamState.includes('MISSING') || upstreamState.includes('NOT')
          ? colors.error(upstreamState)
          : colors.muted(upstreamState);

        console.log(`    ${svc.emoji}  ${host.padEnd(28)} ${statusBadge}`);
        console.log(`        ${colors.muted('upstream:')} ${upstreamBadge}`);
      }

      // ─── 5. DNS resolution check ───────────────────────────────────────
      console.log();
      console.log(colors.primary.bold('  DNS resolution:'));
      console.log(colors.muted('  ' + '─'.repeat(58)));
      const serverIp = getServerIp();
      for (const svc of urls) {
        if (!svc.domainUrl) continue;
        const host = svc.domainUrl.replace(/^https?:\/\//, '').split('/')[0];
        let resolved = '';
        try {
          resolved = execSync(`getent hosts ${host} 2>/dev/null | awk '{print $1}' | head -1`, {
            encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'],
          }).trim();
        } catch { /* ignore */ }
        if (!resolved) {
          try {
            resolved = execSync(`dig +short ${host} | head -1`, {
              encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'],
            }).trim();
          } catch { /* ignore */ }
        }

        const dnsBadge = !resolved
          ? colors.error('NO DNS RECORD')
          : resolved === serverIp
            ? colors.success(`${resolved} ✓ (this server)`)
            : colors.warning(`${resolved} (expected ${serverIp})`);

        console.log(`    ${host.padEnd(32)} ${dnsBadge}`);
      }

      // ─── 6. Recent Traefik logs (errors only) ──────────────────────────
      console.log();
      console.log(colors.muted('  Recent Traefik errors/warnings (filtered, last 50 lines):'));
      try {
        const logs = execSync('docker logs eve-legs-traefik --tail 50 2>&1 | grep -iE "error|warn|level=error|level=warn" || echo ""', {
          encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'],
        }).trim();
        if (!logs) {
          console.log(`    ${colors.success('(no errors or warnings)')}`);
        } else {
          for (const line of logs.split('\n').slice(-10)) {
            const isError = /error|ERR|level=error/i.test(line);
            console.log(`    ${isError ? colors.error(line) : colors.warning(line)}`);
          }
        }
      } catch {
        console.log(colors.muted('    (could not read logs)'));
      }

      // ─── 7. Targeted advice ────────────────────────────────────────────
      console.log();
      console.log(colors.primary.bold('  Hints:'));
      console.log(colors.muted('  ' + '─'.repeat(58)));
      printInfo('  • 404 on a route = Traefik received the request but no rule matched');
      printInfo('    → check the request reaches Traefik with the right Host header');
      printInfo('    → if DNS shows NO DNS RECORD, your A records aren\'t set / propagated');
      printInfo('  • 502 = route matched, upstream down. Check the upstream container is running.');
      printInfo('  • Eve dashboard runs on the HOST (port 7979), not in Docker.');
      printInfo('    Start it with: cd /opt/eve && npx eve ui (or run as a systemd service)');
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
