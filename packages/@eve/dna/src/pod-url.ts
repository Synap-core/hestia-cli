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
 *   4. **Discovery backfill** — probe on-disk artefacts (.env, Traefik,
 *      docker inspect) for the backend URL and persist canonical config.
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
import { existsSync } from "node:fs";
import { configStore } from "./config-store";
import { discoverAndBackfillPodUrl } from "./discover";

let cachedUrl: string | undefined;
let cachedProbe: boolean | undefined;
let cachedDerive: string | undefined;

const LOOPBACK_HOST = "127.0.0.1";
const LOOPBACK_PORT = 14000;
const DOCKER_DNS_URL = "http://eve-brain-synap:4000";
const DOCKER_DNS_TIMEOUT_MS = 300;

export type PodUrlResolutionSource =
  | "env"
  | "secrets"
  | "headers"
  | "discovery"
  | "loopback"
  | "docker-dns"
  | "none";

export interface PodUrlResolutionDiagnostic {
  level: "info" | "warn" | "error";
  code: string;
  message: string;
}

export interface PodUrlResolutionResult {
  podUrl: string;
  source: PodUrlResolutionSource;
  diagnostics: PodUrlResolutionDiagnostic[];
}

function diagnostic(
  level: PodUrlResolutionDiagnostic["level"],
  code: string,
  message: string,
): PodUrlResolutionDiagnostic {
  return { level, code, message };
}

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
 * True when this process is running inside a Docker container. Used to
 * suppress host-loopback URLs from secrets — `127.0.0.1:4000` means
 * "the host's backend port" when read by an on-host eve CLI, but inside
 * a container that same string points to the container's own (empty)
 * loopback. Falling back to docker-dns (`http://eve-brain-synap:4000`)
 * is the right answer in-container.
 */
function isRunningInContainer(): boolean {
  try {
    return existsSync("/.dockerenv");
  } catch {
    return false;
  }
}

/** True when a URL is a host-loopback that won't work from inside a container. */
function isHostLoopbackUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const h = u.hostname.toLowerCase();
    return h === "127.0.0.1" || h === "localhost" || h === "::1";
  } catch {
    return false;
  }
}

/**
 * Read the pod URL from secrets.json via ConfigStore.
 * Resolution order within secrets:
 *   1. `secrets.synap.apiUrl` (the primary configured URL)
 *   2. `secrets.pod.url` (back-compat alias)
 *   3. Derive from `secrets.domain.primary`
 *
 * In-container behaviour: any of the above that resolves to a HOST
 * loopback URL (127.0.0.1 / localhost) is skipped — the dashboard
 * container would dial its own empty loopback. The resolver then
 * falls through to Step 6 (docker-dns) which reaches the backend
 * via `eve-brain-synap:4000`.
 *
 * Returns the first usable string found, or undefined.
 */
async function readPodUrlFromSecrets(): Promise<{ podUrl: string; detail: string } | undefined> {
  const secrets = await configStore.get();
  if (!secrets) return undefined;
  const inContainer = isRunningInContainer();

  const apiUrl = secrets.synap?.apiUrl?.trim();
  if (apiUrl && !(inContainer && isHostLoopbackUrl(apiUrl))) {
    return { podUrl: apiUrl, detail: "secrets.synap.apiUrl" };
  }

  const podUrl = secrets.pod?.url?.trim();
  if (podUrl && !(inContainer && isHostLoopbackUrl(podUrl))) {
    return { podUrl, detail: "secrets.pod.url" };
  }

  const domain = secrets.domain?.primary?.trim();
  if (domain && domain.includes(".") && !domain.startsWith("127.") && !domain.startsWith("localhost")) {
    return { podUrl: `https://pod.${domain}`, detail: "secrets.domain.primary" };
  }

  return undefined;
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
  const result = await resolvePodUrlDetailed(explicitUrl, dashboardUrl, headers);
  return result.podUrl;
}

/**
 * Resolve the dashboard-to-backend URL with source tracking and diagnostics.
 *
 * This preserves `resolvePodUrl` resolution order and return values while
 * exposing enough detail for callers to explain which fallback was used.
 */
export async function resolvePodUrlDetailed(
  explicitUrl?: string,
  dashboardUrl?: string,
  headers?: Headers,
): Promise<PodUrlResolutionResult> {
  const diagnostics: PodUrlResolutionDiagnostic[] = [];

  // Step 1: explicit config wins. Set this at deployment time.
  const envUrl = explicitUrl?.trim() || process.env.NEXT_PUBLIC_POD_URL?.trim();
  if (envUrl) {
    diagnostics.push(diagnostic("info", "pod_url.env", "Resolved pod URL from explicit/env configuration."));
    return { podUrl: envUrl, source: "env", diagnostics };
  }
  diagnostics.push(diagnostic("info", "pod_url.env.empty", "No explicit/env pod URL configured."));

  // Step 2: secrets.json — the operator's actual configured URL.
  const fromSecrets = await readPodUrlFromSecrets();
  if (fromSecrets) {
    diagnostics.push(diagnostic("info", "pod_url.secrets", `Resolved pod URL from ${fromSecrets.detail}.`));
    return { podUrl: fromSecrets.podUrl, source: "secrets", diagnostics };
  }
  diagnostics.push(diagnostic("info", "pod_url.secrets.empty", "No pod URL found in secrets."));

  // Step 3: derive from dashboard URL (production path when secrets aren't set yet).
  if (dashboardUrl) {
    const hostname = headers?.get("x-forwarded-host")
      ?? headers?.get("host")
      ?? undefined;
    const scheme = headers?.get("x-forwarded-proto") ?? "https";
    if (hostname) {
      const derived = deriveFromHost(hostname, scheme);
      if (derived) {
        diagnostics.push(diagnostic("info", "pod_url.headers", "Derived pod URL from request host headers."));
        return { podUrl: derived, source: "headers", diagnostics };
      }
      diagnostics.push(diagnostic("info", "pod_url.headers.unusable", "Request host headers did not contain a routable domain."));
    }
    // Also try parsing the URL itself as a full URL.
    try {
      const u = new URL(dashboardUrl);
      const derived2 = deriveFromHost(u.hostname, u.protocol.replace(":", ""));
      if (derived2) {
        diagnostics.push(diagnostic("info", "pod_url.dashboard_url", "Derived pod URL from dashboard URL."));
        return { podUrl: derived2, source: "headers", diagnostics };
      }
      diagnostics.push(diagnostic("info", "pod_url.dashboard_url.unusable", "Dashboard URL did not contain a routable domain."));
    } catch {
      diagnostics.push(diagnostic("info", "pod_url.dashboard_url.invalid", "Dashboard URL was not a full URL."));
    }
  } else {
    diagnostics.push(diagnostic("info", "pod_url.dashboard_url.empty", "No dashboard URL provided for host derivation."));
  }

  // Step 4: on-disk discovery with canonical write-back.
  const fromDiscovery = await discoverAndBackfillPodUrl();
  if (fromDiscovery) {
    diagnostics.push(diagnostic("info", "pod_url.discovery", "Resolved pod URL from on-disk discovery."));
    return { podUrl: fromDiscovery, source: "discovery", diagnostics };
  }
  diagnostics.push(diagnostic("info", "pod_url.discovery.empty", "On-disk discovery did not find a pod URL."));

  // Step 5: loopback probe.
  if (await probePort(LOOPBACK_HOST, LOOPBACK_PORT, 200)) {
    diagnostics.push(diagnostic("info", "pod_url.loopback", "Resolved pod URL from loopback probe."));
    return { podUrl: `http://${LOOPBACK_HOST}:${LOOPBACK_PORT}`, source: "loopback", diagnostics };
  }
  diagnostics.push(diagnostic("warn", "pod_url.loopback.unreachable", "Loopback backend port is not reachable."));

  // Step 6: Docker DNS.
  if (await isDockerDnsReachable()) {
    diagnostics.push(diagnostic("info", "pod_url.docker_dns", "Resolved pod URL from Docker DNS."));
    return { podUrl: DOCKER_DNS_URL, source: "docker-dns", diagnostics };
  }
  diagnostics.push(diagnostic("warn", "pod_url.docker_dns.unreachable", "Docker DNS backend host is not reachable."));

  // Step 7: no path found.
  diagnostics.push(diagnostic("error", "pod_url.none", "Unable to resolve a pod URL."));
  return { podUrl: "", source: "none", diagnostics };
}

/** Test hook — clear cached probe results. */
export function resetPodUrlCache(): void {
  cachedProbe = undefined;
  cachedUrl = undefined;
  cachedDerive = undefined;
}
