/**
 * Resolve the URL for the dashboard to reach the synap-backend.
 *
 * Resolution order:
 *
 *   1. **Env var (`NEXT_PUBLIC_POD_URL`)** — explicit deployment-time
 *      config. Takes all other paths.
 *
 *   2. **`secrets.json`** — the operator's actual configured URL.
 *      Reads `secrets.synap.apiUrl` → `secrets.pod.url` → derives
 *      `https://pod.{secrets.domain.primary}`. This is the production
 *      source of truth.
 *
 *   3. **Derive from dashboard URL** — when the dashboard is reachable at
 *      `eve.{domain}` (via a reverse proxy), the backend is at
 *      `pod.{domain}` by convention on the same host. Used when secrets
 *      file doesn't exist yet (e.g. very first request during bootstrap).
 *
 *   4. **`discoverPodConfig()`** — probe on-disk artefacts (.env, Traefik,
 *      docker inspect) for the backend URL.
 *
 *   5. **Loopback probe (`127.0.0.1:14000`)** — when the dashboard
 *      runs on the pod host and Eve has published the backend via its
 *      docker-compose.override.yml (sub-millisecond path).
 *
 *   6. **Docker DNS (`http://eve-brain-synap:4000`)** — fallback for
 *      containerized deployments where the backend is on the same Docker
 *      network but the loopback isn't published.
 *
 * The assumption: dashboard and backend run on the same machine, the
 * reverse proxy (Nginx / Caddy / Traefik) maps `eve.{domain}` to the
 * dashboard and `pod.{domain}` to the backend.
 */

import { Socket } from "node:net";
import { readEveSecrets } from "./secrets-contract";
import { discoverPodConfig } from "./discover";

let cachedUrl: string | undefined;
let cachedProbe: boolean | undefined;
let cachedDerive: string | undefined;
let cachedSecrets: string | undefined;

const LOOPBACK_HOST = "127.0.0.1";
const LOOPBACK_PORT = 14000;
const DOCKER_DNS_URL = "http://eve-brain-synap:4000";
const DOCKER_DNS_TIMEOUT_MS = 300;

// ---------------------------------------------------------------------------
// Derive from a hostname (x-forwarded-host / dashboard URL)
// ---------------------------------------------------------------------------

/**
 * Derive the pod URL from a hostname + scheme.
 *
 * If the hostname is `eve.{domain}`, the backend is `pod.{domain}`.
 * If it's bare `{domain}`, the backend is `pod.{domain}`.
 * Returns empty string for loopback or invalid hostnames.
 */
function deriveFromHost(hostname: string, scheme: string): string {
  if (cachedDerive) return cachedDerive;

  // Never derive from hostnames that should use loopback.
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
    return "";
  }

  // Strip `eve.` prefix if present.
  const bareDomain = hostname.startsWith("eve.") ? hostname.slice(4) : hostname;
  if (!bareDomain.includes(".") || bareDomain === "localhost") return "";

  const result = `${scheme}://pod.${bareDomain}`;

  cachedDerive = result;
  return result;
}

// ---------------------------------------------------------------------------
// Probe helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Secrets resolver
// ---------------------------------------------------------------------------

/**
 * Read the pod URL from secrets.json.
 * Resolution order within secrets:
 *   1. `secrets.synap.apiUrl` (the primary configured URL)
 *   2. `secrets.pod.url` (back-compat alias)
 *   3. Derive from `secrets.domain.primary`
 * Returns the first non-empty string found, or undefined.
 */
async function readPodUrlFromSecrets(): Promise<string | undefined> {
  if (cachedSecrets !== undefined) return cachedSecrets;

  try {
    const secrets = await readEveSecrets();
    if (!secrets) {
      cachedSecrets = "";
      return undefined;
    }

    const apiUrl = secrets.synap?.apiUrl?.trim();
    if (apiUrl) { cachedSecrets = apiUrl; return apiUrl; }

    const podUrl = secrets.pod?.url?.trim();
    if (podUrl) { cachedSecrets = podUrl; return podUrl; }

    const domain = secrets.domain?.primary?.trim();
    if (domain && domain.includes(".") && !domain.startsWith("127.") && !domain.startsWith("localhost")) {
      const derived = `https://pod.${domain}`;
      cachedSecrets = derived;
      return derived;
    }

    cachedSecrets = "";
    return undefined;
  } catch {
    cachedSecrets = "";
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Resolve the URL for the dashboard to reach the synap-backend.
 *
 * @param explicitUrl — optional env-var override (e.g. `NEXT_PUBLIC_POD_URL`)
 * @param dashboardUrl — optional URL the browser used to reach this dashboard.
 *   In Next.js route handlers this is `req.url`, which may be a pathname
 *   like `/api/pod/setup-status` (not a full URL). When a pathname is
 *   passed, `x-forwarded-host` and `x-forwarded-proto` headers are
 *   consulted to reconstruct the full URL for derivation.
 * @returns the resolved URL string, or empty string if nothing is reachable
 */
export async function resolvePodUrl(
  explicitUrl?: string,
  dashboardUrl?: string,
  headers?: Headers,
): Promise<string> {
  // Step 1: explicit config wins. Set this at deployment time.
  const envUrl = explicitUrl?.trim() || process.env.NEXT_PUBLIC_POD_URL?.trim();
  if (envUrl) return envUrl;

  // Step 2: secrets.json — the operator's actual configured URL.
  const fromSecrets = await readPodUrlFromSecrets();
  if (fromSecrets) return fromSecrets;

  // Step 3: derive from dashboard URL (production path when secrets aren't set yet).
  if (dashboardUrl) {
    const hostname = headers?.get("x-forwarded-host")
      ?? headers?.get("host")
      ?? undefined;
    const scheme = headers?.get("x-forwarded-proto") ?? "https";
    if (hostname) {
      const derived = deriveFromHost(hostname, scheme);
      if (derived) return derived;
    }
    // Also try parsing the URL itself as a full URL.
    try {
      const u = new URL(dashboardUrl);
      const derived2 = deriveFromHost(u.hostname, u.protocol.replace(":", ""));
      if (derived2) return derived2;
    } catch { /* not a full URL — nothing else to try */ }
  }

  // Step 4: discoverPodConfig() — on-disk discovery.
  const discovered = discoverPodConfig();
  if (discovered.synapUrl) return discovered.synapUrl;

  // Step 5: loopback probe.
  if (await probePort(LOOPBACK_HOST, LOOPBACK_PORT, 200)) {
    return `http://${LOOPBACK_HOST}:${LOOPBACK_PORT}`;
  }

  // Step 6: Docker DNS.
  if (await isDockerDnsReachable()) {
    return DOCKER_DNS_URL;
  }

  // Step 7: no path found.
  return "";
}

/** Test hook — clear cached probe results. */
export function resetPodUrlCache(): void {
  cachedProbe = undefined;
  cachedUrl = undefined;
  cachedDerive = undefined;
  cachedSecrets = undefined;
}
