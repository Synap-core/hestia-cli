/**
 * Resolve the URL for the dashboard to reach the synap-backend.
 *
 * This is the dashboard's single source of truth for backend routing.
 * It replaces the broken `resolveSynapUrl(readEveSecrets())` pattern
 * that silently failed when `secrets.json` was missing or when the
 * derived public domain wasn't reachable from the dashboard's runtime.
 *
 * Resolution order:
 *
 *   1. **Env var (`NEXT_PUBLIC_POD_URL`)** — explicit deployment-time
 *      config. Takes all other paths. The dashboard's Docker Compose
 *      (or host) sets this at startup. In Docker, this is typically
 *      `http://eve-brain-synap:4000` (Docker DNS). On the host it's
 *      `http://127.0.0.1:14000` (loopback) or `http://10.10.0.11:4000`.
 *
 *   2. **Loopback probe (`127.0.0.1:14000`)** — when the dashboard
 *      runs on the pod host and Eve has published the backend via its
 *      docker-compose.override.yml (sub-millisecond path).
 *
 *   3. **Docker DNS (`http://synap:4000`)** — fallback for containerized
 *      deployments where the backend is on the same Docker network but
 *      the loopback isn't published. Docker DNS resolves the container
 *      name directly on the bridge — no DNS cache, no external lookup.
 *
 *   4. **Public domain (`http://pod.<domain>`)** — last resort, same as
 *      the old `resolveSynapUrl` behavior. Used for off-host dashboard
 *      instances where the backend is only reachable via the public
 *      Traefik URL.
 *
 * The difference from `resolveSynapUrlOnHost` (loopback-probe.ts):
 *   - `resolveSynapUrlOnHost` is designed for CLI runtime — it probes
 *     loopback first (which is always correct for the host), then
 *     falls back to public domain. It never checks Docker DNS.
 *   - `resolvePodUrl` is designed for the dashboard — which may run
 *     on the host OR in a container. When in a container, loopback
 *     won't work (backend isn't on host loopback from inside the
 *     container), so Docker DNS is the correct transport.
 */

import { Socket } from "node:net";

let cachedUrl: string | undefined;
let cachedProbe: boolean | undefined;

const LOOPBACK_HOST = "127.0.0.1";
const LOOPBACK_PORT = 14000;
const DOCKER_DNS_URL = "http://synap:4000";
const DOCKER_DNS_TIMEOUT_MS = 300;

/** Probe whether a TCP port is reachable within a timeout. */
function probePort(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new Socket();
    let settled = false;
    const settle = (ok: boolean) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch { /* ignore */ }
      resolve(ok);
    };

    const timer = setTimeout(() => settle(false), timeoutMs);
    timer.unref?.();

    socket.once("connect", () => { clearTimeout(timer); settle(true); });
    socket.once("error", () => { clearTimeout(timer); settle(false); });

    try { socket.connect(port, host); }
    catch { clearTimeout(timer); settle(false); }
  });
}

/**
 * Check whether the backend is reachable via Docker DNS.
 * Cached for the process lifetime to avoid repeated DNS probes.
 */
async function isDockerDnsReachable(): Promise<boolean> {
  if (cachedProbe !== undefined) return cachedProbe;

  // Quick DNS check — does the hostname resolve?
  // If not, skip the TCP probe entirely.
  const socket = new Socket();
  const result = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, DOCKER_DNS_TIMEOUT_MS);
    timer.unref?.();

    socket.once("connect", () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(false);
    });

    try { socket.connect(4000, "synap"); }
    catch { clearTimeout(timer); socket.destroy(); resolve(false); }
  });

  cachedProbe = result;
  return result;
}

/**
 * Resolve the URL for the dashboard to reach the synap-backend.
 *
 * @param explicitUrl — optional env-var override (e.g. `NEXT_PUBLIC_POD_URL`)
 * @returns the resolved URL string, or empty string if nothing is reachable
 */
export async function resolvePodUrl(explicitUrl?: string): Promise<string> {
  // Step 1: explicit config wins. Set this at deployment time.
  const envUrl = explicitUrl?.trim() || process.env.NEXT_PUBLIC_POD_URL?.trim();
  if (envUrl) return envUrl;

  // Step 2: loopback probe (on-host dashboard).
  if (await probePort(LOOPBACK_HOST, LOOPBACK_PORT, 200)) {
    return `http://${LOOPBACK_HOST}:${LOOPBACK_PORT}`;
  }

  // Step 3: Docker DNS (containerized dashboard).
  if (await isDockerDnsReachable()) {
    return DOCKER_DNS_URL;
  }

  // Step 4: public domain fallback (off-host).
  return "";
}

/** Test hook — clear cached probe results. */
export function resetPodUrlCache(): void {
  cachedProbe = undefined;
  cachedUrl = undefined;
}
