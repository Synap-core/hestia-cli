import type { Command } from 'commander';
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { writeEveSecrets, readEveSecrets, getAccessUrls, getServerIp, entityStateManager } from '@eve/dna';
import { TraefikService } from '@eve/legs';
import { colors, printSuccess, printInfo, printWarning, printError } from '../lib/ui.js';
import { probeRoutes, probeSummary, probeVerdict, type RouteProbe } from '../lib/probe-routes.js';

/** Render a per-route probe summary as a small table (used by `set` + `check`). */
function renderProbeTable(probes: RouteProbe[]): void {
  console.log(colors.muted('  ' + '─'.repeat(60)));
  for (const p of probes) {
    const dot = p.outcome === 'ok'
      ? colors.success('●')
      : p.outcome === 'upstream-down'
        ? colors.warning('●')
        : colors.error('●');
    const status = p.outcome === 'ok'
      ? colors.success(`${p.httpStatus} reachable`)
      : p.outcome === 'upstream-down'
        ? colors.warning(`${p.httpStatus} upstream down`)
        : p.outcome === 'not-routing'
          ? colors.error(`${p.httpStatus} no route match`)
          : p.outcome === 'dns-missing'
            ? colors.error('DNS missing')
            : p.outcome === 'dns-wrong'
              ? colors.warning(`DNS → ${p.dnsResolved}`)
              : colors.error('timeout');
    console.log(`  ${dot} ${p.host.padEnd(34)} ${status}`);
  }
}

/** Render an actionable hint for a single failing probe. */
function renderProbeHint(p: RouteProbe): void {
  switch (p.outcome) {
    case 'dns-missing':
      printInfo(`  • ${p.host}: create A record pointing to your server IP`);
      break;
    case 'dns-wrong':
      printInfo(`  • ${p.host}: DNS resolves to ${p.dnsResolved}; update A record to your server IP`);
      break;
    case 'upstream-down':
      printInfo(`  • ${p.host}: route exists but upstream is down — check the container is running`);
      break;
    case 'not-routing':
      printInfo(`  • ${p.host}: Traefik has no rule matching — try \`eve domain repair\``);
      break;
    case 'timeout':
      printInfo(`  • ${p.host}: request timed out — check Traefik is running on port 80`);
      break;
    case 'ok':
      break;
  }
}

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

      let writeOk = false;
      try {
        const traefik = new TraefikService();
        await traefik.configureSubdomains(domainName, !!opts.ssl, opts.email, installedComponents);
        writeOk = true;
      } catch (err) {
        printError(`Could not write Traefik config: ${err instanceof Error ? err.message : String(err)}`);
        printInfo('Run this command on your server (where Docker is available).');
        return;
      }

      const secrets = await readEveSecrets(process.cwd());
      const urls = getAccessUrls(secrets, installedComponents);

      // ─── DNS records the user needs to create ───────────────────────────
      const serverIp = getServerIp();
      const subdomainsNeeded = urls
        .filter(u => u.domainUrl)
        .map(u => u.domainUrl!.replace(/^https?:\/\//, '').split('/')[0].replace(`.${domainName}`, ''));

      console.log();
      console.log(colors.primary.bold('DNS records you must create:'));
      console.log(colors.muted('─'.repeat(60)));
      console.log(colors.muted('  Type   Name                          Value'));
      for (const sub of subdomainsNeeded) {
        const name = `${sub}.${domainName}`.padEnd(32);
        const value = serverIp ?? colors.warning('<your-server-ip>');
        console.log(`  ${colors.primary('A')}      ${name}${value}`);
      }
      console.log(colors.muted('─'.repeat(60)));
      if (!serverIp) printInfo('Could not detect server IP — replace <your-server-ip> above.');

      // ─── Live probe — don't print ✅ unless routes actually work ────────
      if (writeOk) {
        console.log();
        console.log(colors.primary.bold('Verifying routes (probing each subdomain)...'));
        // Give Traefik a beat to reload after restart
        await new Promise(r => setTimeout(r, 1500));
        const probes = probeRoutes(urls);
        renderProbeTable(probes);

        const verdict = probeVerdict(probes);
        console.log();
        if (verdict === 'ok') {
          printSuccess(`Domain configured and all ${probes.length} routes are healthy.`);
        } else if (verdict === 'partial') {
          const broken = probes.filter(p => p.outcome !== 'ok');
          printWarning(`Domain configured, but ${broken.length}/${probes.length} routes need attention:`);
          for (const p of broken) renderProbeHint(p);
        } else {
          printError(`Domain configured but no routes are reachable yet.`);
          for (const p of probes) renderProbeHint(p);
        }
        if (opts.ssl) {
          console.log();
          printInfo('SSL certificates will provision automatically once DNS propagates (1–5 min).');
        }
      }
      console.log();
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

      // ─── 4. Probe each route end-to-end (HTTP + DNS) ───────────────────
      console.log();
      console.log(colors.primary.bold('  Per-route probe (Host header → Traefik → upstream):'));

      let installedComponents: string[] | undefined;
      try { installedComponents = await entityStateManager.getInstalledComponents(); } catch { /* ignore */ }
      const urls = getAccessUrls(secrets, installedComponents);
      const probes = probeRoutes(urls);
      renderProbeTable(probes);

      // ─── 6. Traefik admin API — what routers are ACTUALLY loaded? ──────
      console.log();
      console.log(colors.primary.bold('  Routers loaded inside Traefik (via admin API :8080):'));
      console.log(colors.muted('  ' + '─'.repeat(58)));
      let loadedRouters: Array<{ name: string; rule: string; status: string }> = [];
      try {
        const apiOut = execSync('curl -s --max-time 3 http://localhost:8080/api/http/routers', {
          encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'],
        }).trim();
        if (apiOut) {
          const parsed = JSON.parse(apiOut) as Array<{ name: string; rule: string; status?: string }>;
          loadedRouters = parsed.map(r => ({ name: r.name, rule: r.rule, status: r.status ?? 'unknown' }));
        }
      } catch { /* admin API unreachable */ }

      if (loadedRouters.length === 0) {
        console.log(`    ${cross} ${colors.error('NO ROUTERS LOADED!')} Traefik can't see your config file.`);
        console.log();
        console.log(colors.warning('  Likely causes:'));
        console.log(colors.warning('    1. Volume mount broken — re-create container'));
        console.log(colors.warning('    2. YAML syntax error — Traefik silently dropped the config'));
        console.log(colors.warning('    3. Static config missing providers.file directive'));
      } else {
        for (const r of loadedRouters) {
          const enabled = r.status === 'enabled' ? colors.success('enabled') : colors.error(r.status);
          console.log(`    ${r.name.padEnd(28)} ${enabled}  ${colors.muted(r.rule)}`);
        }
      }

      // ─── 7. What the container actually sees ───────────────────────────
      console.log();
      console.log(colors.primary.bold('  What Traefik container sees (docker exec):'));
      console.log(colors.muted('  ' + '─'.repeat(58)));
      try {
        const containerStaticHead = execSync(
          'docker exec eve-legs-traefik cat /etc/traefik/traefik.yml 2>&1 | head -8',
          { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] },
        ).trim();
        console.log(colors.muted('    /etc/traefik/traefik.yml (first 8 lines):'));
        for (const line of containerStaticHead.split('\n')) {
          console.log(`      ${colors.muted(line)}`);
        }
      } catch {
        console.log(`    ${cross} Could not read static config inside container`);
      }
      try {
        const containerLs = execSync(
          'docker exec eve-legs-traefik ls -la /etc/traefik/dynamic/ 2>&1',
          { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] },
        ).trim();
        console.log();
        console.log(colors.muted('    /etc/traefik/dynamic/ (container view):'));
        for (const line of containerLs.split('\n')) {
          console.log(`      ${colors.muted(line)}`);
        }
      } catch {
        console.log(`    ${cross} Could not list dynamic dir inside container`);
      }

      // ─── 8. Recent Traefik logs (errors + provider events) ─────────────
      console.log();
      console.log(colors.muted('  Traefik errors / config events (last 30 relevant lines):'));
      try {
        const logs = execSync(
          'docker logs eve-legs-traefik 2>&1 | grep -iE "error|warn|provider|configuration|cannot|failed|unable|loaded|started" | grep -v "Peeking first byte" | tail -30 || echo ""',
          { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] },
        ).trim();
        if (!logs) {
          console.log(`    ${colors.muted('(no relevant log entries)')}`);
        } else {
          for (const line of logs.split('\n')) {
            const isError = /error|ERR|level=error|fail|unable|cannot/i.test(line);
            console.log(`    ${isError ? colors.error(line) : colors.muted(line)}`);
          }
        }
      } catch {
        console.log(colors.muted('    (could not read logs)'));
      }

      // ─── 9. Targeted advice ────────────────────────────────────────────
      console.log();
      console.log(colors.primary.bold('  Hints:'));
      console.log(colors.muted('  ' + '─'.repeat(58)));
      if (loadedRouters.length === 0) {
        printError('  Traefik has NO routers loaded — your routes file is being ignored.');
        printInfo('  Try re-running: eve domain set <yourdomain>');
        printInfo('  If that doesn\'t fix it, recreate the Traefik container:');
        printInfo('    docker rm -f eve-legs-traefik');
        printInfo('    eve install --components=traefik');
        printInfo('    eve domain set <yourdomain>');
      } else {
        printInfo('  • 404 with routers loaded = Host header mismatch. Test with:');
        printInfo('      curl -v -H "Host: eve.<domain>" http://localhost/');
        printInfo('  • 502 = route matched, upstream down. Check upstream containers.');
        printInfo('  • Eve dashboard runs on the HOST (port 7979), not in Docker.');
        printInfo('      Start it with: cd /opt/eve && npx eve ui');
      }
      console.log();
    });

  domain
    .command('repair')
    .description('Recreate Traefik with clean state — fixes stale routes & broken volume mounts')
    .action(async () => {
      const secrets = await readEveSecrets(process.cwd());
      const domainName = secrets?.domain?.primary;
      if (!domainName) {
        printError('No domain configured. Run: eve domain set <yourdomain> first.');
        process.exit(1);
      }

      console.log();
      console.log(colors.primary.bold('Eve — Traefik repair'));
      console.log(colors.muted('─'.repeat(60)));
      console.log();

      // 1. Remove the running Traefik container (releases stale bind mounts)
      printInfo('Removing existing Traefik container...');
      try {
        execSync('docker rm -f eve-legs-traefik', { stdio: 'inherit' });
      } catch { /* container may not exist */ }

      // 2. Wipe stale dynamic config files (legacy from pre-Eve installs)
      const HOST_DYNAMIC_DIR = '/opt/traefik/dynamic';
      const HOST_STATIC_CONFIG = '/opt/traefik/traefik.yml';
      if (existsSync(HOST_DYNAMIC_DIR)) {
        printInfo('Cleaning stale dynamic config files...');
        try {
          for (const file of readdirSync(HOST_DYNAMIC_DIR)) {
            if (file.endsWith('.yml') || file.endsWith('.yaml')) {
              const path = join(HOST_DYNAMIC_DIR, file);
              try {
                unlinkSync(path);
                console.log(`  ${colors.muted('•')} removed ${file}`);
              } catch (err) {
                printWarning(`  could not remove ${file}: ${err instanceof Error ? err.message : String(err)}`);
              }
            }
          }
        } catch (err) {
          printWarning(`  could not read ${HOST_DYNAMIC_DIR}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      // 3. Also remove the static config so a fresh one is generated
      if (existsSync(HOST_STATIC_CONFIG)) {
        try {
          unlinkSync(HOST_STATIC_CONFIG);
          console.log(`  ${colors.muted('•')} removed traefik.yml`);
        } catch { /* non-fatal */ }
      }

      // 4. Reinstall Traefik (recreates container with proper bind mounts)
      printInfo('Reinstalling Traefik (fresh container)...');
      const traefik = new TraefikService();
      await traefik.install();

      // 5. Reapply domain routes
      printInfo('Applying domain routes...');
      let installedComponents: string[] | undefined;
      try { installedComponents = await entityStateManager.getInstalledComponents(); } catch { /* ignore */ }
      await traefik.configureSubdomains(domainName, !!secrets?.domain?.ssl, secrets?.domain?.email, installedComponents);

      console.log();
      printSuccess('Repair complete. Run `eve domain check` to verify.');
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
