/**
 * Post-install verification for components.
 *
 * Confirms a freshly installed component is actually serving — container
 * running, port reachable. Surfaces silent install failures (the `docker run`
 * returned 0 but the container crash-looped) so we don't mark state as `ready`
 * when the service is in fact broken.
 */

import { execSync } from 'node:child_process';
import { resolveComponent } from '@eve/dna';

export interface VerifyResult {
  ok: boolean;
  /** What was checked. */
  checks: Array<{ name: string; ok: boolean; detail?: string }>;
  /** One-line summary suitable for spinner.succeed/fail. */
  summary: string;
}

/** Sleep helper. */
function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

/** True if `docker ps` shows the container running. */
function isContainerRunning(name: string): boolean {
  try {
    const out = execSync(`docker ps --filter "name=^${name}$" --format "{{.Names}}"`, {
      encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();
    return out === name;
  } catch {
    return false;
  }
}

/** True if Traefik can curl the upstream successfully (any 2xx/3xx/401/403/404). */
function canReachFromTraefik(host: string, port: number, path: string): boolean {
  try {
    const code = execSync(
      `docker exec eve-legs-traefik wget -q -O /dev/null --timeout=3 --server-response http://${host}:${port}${path} 2>&1 | grep "HTTP/" | tail -1 || echo "no-response"`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] },
    ).trim();
    // wget --server-response prints the response status line. Anything < 500 means we got a response.
    if (code.includes('no-response')) return false;
    const match = code.match(/HTTP\/\S+\s+(\d{3})/);
    if (!match) return false;
    const status = parseInt(match[1], 10);
    return status < 500;
  } catch {
    return false;
  }
}

/**
 * Run all checks for a component. For services that aren't HTTP-ish (no
 * service field), only state is checked. Retries reachability for ~10 seconds
 * to account for slow container start.
 */
export async function verifyComponent(componentId: string): Promise<VerifyResult> {
  const checks: VerifyResult['checks'] = [];
  let comp;
  try {
    comp = resolveComponent(componentId);
  } catch {
    return {
      ok: false,
      checks: [{ name: 'registry', ok: false, detail: `unknown component: ${componentId}` }],
      summary: `unknown component: ${componentId}`,
    };
  }

  // No service → trivially "ok" (e.g. opencode, dokploy aren't HTTP services)
  if (!comp.service) {
    return {
      ok: true,
      checks: [{ name: 'service', ok: true, detail: 'no network service to verify' }],
      summary: `${comp.label} install complete (no network service)`,
    };
  }

  const containerName = comp.service.containerName;

  // Step 1 — container running (retry up to 5x with 1.5s gap)
  let running = false;
  for (let i = 0; i < 5; i++) {
    if (isContainerRunning(containerName)) { running = true; break; }
    await sleep(1500);
  }
  checks.push({
    name: 'container',
    ok: running,
    detail: running ? `${containerName} is running` : `${containerName} not in docker ps after 7.5s`,
  });
  if (!running) {
    return { ok: false, checks, summary: `${comp.label}: container not running` };
  }

  // Step 2 — reachable from Traefik (retry up to 4x with 2s gap, total 10s)
  if (comp.service.healthPath) {
    let reachable = false;
    for (let i = 0; i < 4; i++) {
      if (canReachFromTraefik(containerName, comp.service.internalPort, comp.service.healthPath)) {
        reachable = true; break;
      }
      await sleep(2000);
    }
    checks.push({
      name: 'reachable',
      ok: reachable,
      detail: reachable
        ? `responded on :${comp.service.internalPort}${comp.service.healthPath}`
        : `not responding on :${comp.service.internalPort}${comp.service.healthPath} after 10s`,
    });
    if (!reachable) {
      return { ok: false, checks, summary: `${comp.label}: container running but not responding on its port` };
    }
  }

  return { ok: true, checks, summary: `${comp.label}: container running and reachable` };
}
