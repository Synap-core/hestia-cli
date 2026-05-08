/**
 * Resolve the URL for the dashboard to reach the synap-backend.
 *
 * Resolution order:
 *
 *   1. **Env var (`NEXT_PUBLIC_POD_URL`)** — explicit deployment-time
 *      config. Takes all other paths.
 *
 *   2. **Derive from dashboard URL** — when the dashboard is reachable at
 *      `eve.{domain}` (via a reverse proxy), the backend is at
 *      `pod.{domain}` by convention on the same host. This is the
 *      production path.
 *
 *   3. **Loopback probe (`127.0.0.1:14000`)** — when the dashboard
 *      runs on the pod host and Eve has published the backend via its
 *      docker-compose.override.yml (sub-millisecond path).
 *
 *   4. **Docker DNS (`http://eve-brain-synap:4000`)** — fallback for
 *      containerized deployments where the backend is on the same Docker
 *      network but the loopback isn't published.
 *
 * The assumption: dashboard and backend run on the same machine, the
 * reverse proxy (Nginx / Caddy / Traefik) maps `eve.{domain}` to the
 * dashboard and `pod.{domain}` to the backend. `resolvePodUrl` derives
 * the backend URL by replacing the `eve.` prefix with `pod.`.
 */

import { Socket } from "node:net";

let cachedUrl: string | undefined;
let cachedProbe: boolean | undefined;
let cachedDerive: string | undefined;

const LOOPBACK_HOST = "127.0.0.1";
const LOOPBACK_PORT = 14000;
const DOCKER_DNS_URL = "http://eve-brain-synap:4000";
const DOCKER_DNS_TIMEOUT_MS = 300;

/**
 * Derive the pod URL from the dashboard URL.
 *
 * If the dashboard is at `eve.{domain}`, the backend is at `pod.{domain}`.
 * If it's at bare `{domain}`, the backend is at `pod.{domain}`.
 * If it's at `127.0.0.1` or `localhost`, returns empty string (use loopback).
 *
 * @param dashboardUrl — the URL the browser used to reach the dashboard
 *   (including scheme, e.g. `https://eve.example.com`)
 */
function derivePodUrl(dashboardUrl: string): string {
  if (cachedDerive) return cachedDerive;

  let hostname: string;
  try {
    const u = new URL(dashboardUrl);
    hostname = u.hostname;
  } catch {
    return "";
  }

  // Never derive from hostnames that should use loopback.
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
    return "";
  }

  // Strip `eve.` prefix if present.
  const bareDomain = hostname.startsWith("eve.") ? hostname.slice(4) : hostname;
  if (!bareDomain.includes(".") || bareDomain === "localhost") return "";

  // Use HTTPS if the original URL was HTTPS, otherwise HTTP.
  const scheme = dashboardUrl.startsWith("https:") ? "https" : "http";
  const result = `${scheme}://pod.${bareDomain}`;

  cachedDerive = result;
  return result;
}

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

    try { socket.connect(4000, "eve-brain-synap"); }
    catch { clearTimeout(timer); socket.destroy(); resolve(false); }
  });

  cachedProbe = result;
  return result;
}

/**
 * Resolve the URL for the dashboard to reach the synap-backend.
 *
 * @param explicitUrl — optional env-var override (e.g. `NEXT_PUBLIC_POD_URL`)
 * @param dashboardUrl — optional URL the browser used to reach this dashboard
 *   (e.g. `https://eve.example.com`). When provided, `resolvePodUrl` derives
 *   the backend URL by replacing `eve.` with `pod.` — the production path.
 * @returns the resolved URL string, or empty string if nothing is reachable
 */
export async function resolvePodUrl(explicitUrl?: string, dashboardUrl?: string): Promise<string> {
  // Step 1: explicit config wins. Set this at deployment time.
  const envUrl = explicitUrl?.trim() || process.env.NEXT_PUBLIC_POD_URL?.trim();
  if (envUrl) return envUrl;

  // Step 2: derive from dashboard URL (production path).
  if (dashboardUrl) {
    const derived = derivePodUrl(dashboardUrl);
    if (derived) return derived;
  }

  // Step 3: loopback probe (on-host dashboard).
  if (await probePort(LOOPBACK_HOST, LOOPBACK_PORT, 200)) {
    return `http://${LOOPBACK_HOST}:${LOOPBACK_PORT}`;
  }

  // Step 4: Docker DNS (containerized dashboard).
  if (await isDockerDnsReachable()) {
    return DOCKER_DNS_URL;
  }

  // Step 5: no path found.
  return "";
}

/** Test hook — clear cached probe results. */
export function resetPodUrlCache(): void {
  cachedProbe = undefined;
  cachedUrl = undefined;
}
