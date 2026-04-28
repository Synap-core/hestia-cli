import { Command } from 'commander';
import { execSync, spawnSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';

const CONTAINER = 'eve-legs-traefik';
const CONFIG_DIR = '/opt/traefik';
const API = 'http://localhost:8080/api';

function tryFetch(url: string): unknown | null {
  try {
    const out = execSync(`curl -sf "${url}"`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] });
    return JSON.parse(out);
  } catch {
    return null;
  }
}

export function statusCommand(program: Command): void {
  program
    .command('status')
    .description('Show Traefik health, routes, and config')
    .option('--logs', 'Show last 30 lines of Traefik logs')
    .action((opts: { logs?: boolean }) => {
      console.log('\n🦿  Eve Legs — Traefik Status\n');

      // 1. Container running?
      let running = false;
      try {
        const out = execSync(
          `docker ps --filter "name=${CONTAINER}" --format "{{.Names}}\\t{{.Status}}"`,
          { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] },
        ).trim();
        running = out.includes(CONTAINER);
        if (running) {
          console.log(`  Container:  ✓ running  (${out.split('\t')[1] ?? ''})`);
        } else {
          console.log(`  Container:  ✗ NOT running`);
        }
      } catch {
        console.log(`  Container:  ✗ docker error`);
      }

      // 2. Config files present?
      const staticExists = existsSync(`${CONFIG_DIR}/traefik.yml`);
      const dynamicExists = existsSync(`${CONFIG_DIR}/dynamic/eve-routes.yml`);
      console.log(`  Static cfg: ${staticExists ? '✓' : '✗ MISSING'} ${CONFIG_DIR}/traefik.yml`);
      console.log(`  Routes cfg: ${dynamicExists ? '✓' : '✗ MISSING'} ${CONFIG_DIR}/dynamic/eve-routes.yml`);

      // 3. Show static config
      if (staticExists) {
        console.log('\n  ── traefik.yml ──────────────────────────────────');
        console.log(readFileSync(`${CONFIG_DIR}/traefik.yml`, 'utf-8').split('\n').map(l => '  ' + l).join('\n'));
      }

      // 4. Show dynamic config
      if (dynamicExists) {
        console.log('\n  ── eve-routes.yml ───────────────────────────────');
        console.log(readFileSync(`${CONFIG_DIR}/dynamic/eve-routes.yml`, 'utf-8').split('\n').map(l => '  ' + l).join('\n'));
      }

      // 5. Traefik API — active routers
      if (running) {
        console.log('\n  ── Active routers (Traefik API) ─────────────────');
        const routers = tryFetch(`${API}/http/routers`) as Array<{ name: string; rule: string; status: string; entryPoints: string[] }> | null;
        if (!routers) {
          console.log('  Could not reach Traefik API at port 8080 — is insecure API enabled?');
        } else if (routers.length === 0) {
          console.log('  No routers registered yet');
        } else {
          for (const r of routers) {
            const status = r.status === 'enabled' ? '✓' : '✗';
            console.log(`  ${status} ${r.name}`);
            console.log(`      Rule:   ${r.rule}`);
            console.log(`      Entry:  ${(r.entryPoints ?? []).join(', ')}`);
            console.log(`      Status: ${r.status}`);
          }
        }

        // 6. TLS certificates
        const certs = tryFetch(`${API}/tls/certificates`) as Array<{ subject: { commonName: string }; notAfter: string }> | null;
        if (certs && certs.length > 0) {
          console.log('\n  ── TLS Certificates ─────────────────────────────');
          for (const c of certs) {
            console.log(`  ✓ ${c.subject?.commonName}  (expires ${c.notAfter})`);
          }
        } else if (certs !== null) {
          console.log('\n  ── TLS Certificates ─────────────────────────────');
          console.log('  No certificates yet — DNS must propagate before Let\'s Encrypt can provision');
        }
      }

      // 7. Logs
      if (opts.logs || !running) {
        console.log('\n  ── Traefik logs (last 30 lines) ─────────────────');
        spawnSync('docker', ['logs', '--tail', '30', CONTAINER], { stdio: 'inherit' });
      }

      console.log();
    });
}
