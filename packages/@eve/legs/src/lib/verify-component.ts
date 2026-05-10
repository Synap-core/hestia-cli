/**
 * Post-install verification for components.
 *
 * Confirms a freshly installed component is actually serving — container
 * running, port reachable. Surfaces silent install failures (the `docker run`
 * returned 0 but the container crash-looped) so we don't mark state as `ready`
 * when the service is in fact broken.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolveComponent } from '@eve/dna';

const execFileAsync = promisify(execFile);

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

/**
 * Hard cap (ms) on every docker subprocess we spawn. Without this, a stuck
 * docker daemon or paused container can hold a single check open for the
 * full retry budget and — because execFile shares the Node event loop with
 * other awaiters — block all sibling probes that should be running in
 * parallel via `Promise.all`. The legacy `execSync` version of this file
 * blocked the entire event loop, which is what made the dashboard's
 * `/api/doctor` route hang for minutes when probing many components.
 */
const DOCKER_CALL_TIMEOUT_MS = 4000;

/**
 * True if `docker ps` shows the container running, OR a running container is
 * registered on eve-network under that name as an alias.
 *
 * The alias path matters for components like Synap where the registry stores
 * `containerName: 'eve-brain-synap'` (the eve-network DNS alias) but the
 * actual container name is `synap-backend-backend-1` (managed by synap-backend's
 * compose project). Without the alias probe, verifyComponent kept reporting
 * "container not running" the moment after a successful install, because the
 * exact name match always missed.
 */
async function isContainerRunning(name: string): Promise<boolean> {
  // Fast path: exact name match in `docker ps`.
  try {
    const { stdout } = await execFileAsync(
      'docker',
      ['ps', '--filter', `name=^${name}$`, '--format', '{{.Names}}'],
      { timeout: DOCKER_CALL_TIMEOUT_MS },
    );
    if (stdout.trim() === name) return true;
  } catch {
    // Fall through to alias probe.
  }

  // Alias path: any running container on eve-network registered with `name`
  // as a network alias. We inspect each running container, not the network,
  // because `docker network inspect` doesn't always expose Aliases verbatim
  // across docker engine versions.
  try {
    const { stdout: ids } = await execFileAsync(
      'docker',
      ['ps', '--filter', `network=eve-network`, '--format', '{{.ID}}'],
      { timeout: DOCKER_CALL_TIMEOUT_MS },
    );
    const containerIds = ids.trim().split('\n').filter(Boolean);
    for (const id of containerIds) {
      try {
        const { stdout: aliasJson } = await execFileAsync(
          'docker',
          ['inspect', '--format', '{{json .NetworkSettings.Networks}}', id],
          { timeout: DOCKER_CALL_TIMEOUT_MS },
        );
        const networks = JSON.parse(aliasJson.trim()) as Record<string, { Aliases?: string[] | null }>;
        const aliases = networks['eve-network']?.Aliases ?? [];
        if (aliases.includes(name)) return true;
      } catch {
        continue;
      }
    }
  } catch {
    // Network not present, daemon down, etc — treat as not-running.
  }
  return false;
}

/** True if Traefik can curl the upstream successfully (any 2xx/3xx/401/403/404). */
async function canReachFromTraefik(host: string, port: number, path: string): Promise<boolean> {
  try {
    // wget already has its own --timeout; the outer execFile timeout is a
    // belt-and-braces guard for the case where docker exec itself stalls
    // (e.g. paused container, daemon under load).
    const { stdout } = await execFileAsync(
      'docker',
      [
        'exec', 'eve-legs-traefik',
        'sh', '-c',
        `wget -q -O /dev/null --timeout=3 --server-response http://${host}:${port}${path} 2>&1 | grep "HTTP/" | tail -1 || echo "no-response"`,
      ],
      { timeout: DOCKER_CALL_TIMEOUT_MS },
    );
    const out = stdout.trim();
    if (out.includes('no-response')) return false;
    const match = out.match(/HTTP\/\S+\s+(\d{3})/);
    if (!match) return false;
    return parseInt(match[1], 10) < 500;
  } catch {
    return false;
  }
}

export interface VerifyOptions {
  /**
   * Fast snapshot mode — skip the retry loops. Used by the dashboard's
   * `/api/doctor` route, which is called interactively and must return
   * in ~1s. Default is the slower retry-friendly mode used by post-install
   * verification.
   */
  quick?: boolean;
}

/**
 * Run all checks for a component. For services that aren't HTTP-ish (no
 * service field), only state is checked. By default retries reachability
 * for ~10 seconds to account for slow container start; pass `{ quick: true }`
 * for a fast snapshot (single probe, no retries).
 */
export async function verifyComponent(
  componentId: string,
  opts: VerifyOptions = {},
): Promise<VerifyResult> {
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
  const containerAttempts = opts.quick ? 1 : 5;
  const reachableAttempts = opts.quick ? 1 : 4;

  // Step 1 — container running. Retries: 5x in slow mode (~7.5s budget),
  // 1x in quick mode (single probe).
  let running = false;
  for (let i = 0; i < containerAttempts; i++) {
    if (await isContainerRunning(containerName)) { running = true; break; }
    if (i < containerAttempts - 1) await sleep(1500);
  }
  checks.push({
    name: 'container',
    ok: running,
    detail: running
      ? `${containerName} is running`
      : opts.quick
        ? `${containerName} not in docker ps`
        : `${containerName} not in docker ps after 7.5s`,
  });
  if (!running) {
    return { ok: false, checks, summary: `${comp.label}: container not running` };
  }

  // Step 2 — reachable from Traefik. 4x retries in slow mode (~10s budget),
  // 1x in quick mode.
  if (comp.service.healthPath) {
    let reachable = false;
    for (let i = 0; i < reachableAttempts; i++) {
      if (await canReachFromTraefik(containerName, comp.service.internalPort, comp.service.healthPath)) {
        reachable = true; break;
      }
      if (i < reachableAttempts - 1) await sleep(2000);
    }
    checks.push({
      name: 'reachable',
      ok: reachable,
      detail: reachable
        ? `responded on :${comp.service.internalPort}${comp.service.healthPath}`
        : opts.quick
          ? `not responding on :${comp.service.internalPort}${comp.service.healthPath}`
          : `not responding on :${comp.service.internalPort}${comp.service.healthPath} after 10s`,
    });
    if (!reachable) {
      return { ok: false, checks, summary: `${comp.label}: container running but not responding on its port` };
    }
  }

  return { ok: true, checks, summary: `${comp.label}: container running and reachable` };
}
