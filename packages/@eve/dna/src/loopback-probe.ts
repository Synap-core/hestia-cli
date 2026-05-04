/**
 * On-host loopback detection for the synap-backend HTTP API.
 *
 * # The premise
 *
 * `@eve/lifecycle` writes a `docker-compose.override.yml` next to the
 * synap compose file that maps `127.0.0.1:14000 → backend:4000`. When
 * present, the on-host CLI can talk to the backend with plain HTTP, no
 * Traefik, no TLS, no public DNS — the same fast path Vault, Consul,
 * Caddy admin and the K8s apiserver use locally. See
 * `synap-team-docs/content/team/devops/eve-cli-transports.mdx` for the
 * full architecture.
 *
 * # Why this is a probe, not a config flag
 *
 * Whether the loopback is reachable depends on:
 *   - Whether the override file exists (Eve usually wrote it; user might
 *     have removed or replaced it)
 *   - Whether the backend container is running and bound to that port
 *   - Whether port 14000 is shadowed by something else on the host
 *
 * A stored "use loopback: yes/no" flag would drift from reality on every
 * `compose down`, every host reboot, every override edit. Probing once
 * per process tells the truth without any persistence.
 *
 * # Cost
 *
 * One TCP `connect` to 127.0.0.1:14000 with a 200ms deadline, cached for
 * the life of the process. Loopback connect is ~sub-millisecond when the
 * port is open; the deadline only fires when nothing's listening, in
 * which case Linux returns ECONNREFUSED immediately anyway. Net cost:
 * imperceptible.
 */

import { Socket } from "node:net";
import { resolveSynapUrl, SYNAP_HOST_LOOPBACK_PORT } from "./components.js";

let cachedReachable: boolean | undefined;

/**
 * Test whether `127.0.0.1:14000` accepts TCP connections right now.
 *
 * Cached for the process lifetime — if the backend goes down between
 * the first call and a later one, we'll still report "reachable" until
 * the next CLI invocation. That's fine: the CLI is a short-lived
 * process, and a transient backend outage in mid-command is going to
 * fail the actual HTTP call anyway with a clearer error.
 */
export async function isSynapLoopbackReachable(timeoutMs = 200): Promise<boolean> {
  if (cachedReachable !== undefined) return cachedReachable;
  cachedReachable = await probeTcpPort("127.0.0.1", SYNAP_HOST_LOOPBACK_PORT, timeoutMs);
  return cachedReachable;
}

/** Test hook — clear the cached probe result. */
export function resetSynapLoopbackProbeCache(): void {
  cachedReachable = undefined;
}

/**
 * Resolve the URL the on-host CLI should hit for synap-backend.
 *
 * Decision order:
 *   1. **Loopback is reachable** → `http://127.0.0.1:14000`. Bypasses
 *      Traefik entirely. Works before any DNS or cert is configured.
 *   2. **Loopback is NOT reachable** → fall back to `resolveSynapUrl`
 *      (public URL via `domain.primary`, or stored override, or a
 *      hardcoded loopback as last resort).
 *
 * This is the function CLI runtime callers should use. `resolveSynapUrl`
 * stays pure (no I/O) for embedding URLs into other containers' .env
 * files — those containers reach the backend via Docker DNS on
 * `eve-network`, not via host loopback, and don't want this probe.
 */
export async function resolveSynapUrlOnHost(
  secrets: { synap?: { apiUrl?: string }; domain?: { primary?: string; ssl?: boolean } } | null | undefined,
): Promise<string> {
  if (await isSynapLoopbackReachable()) {
    return `http://127.0.0.1:${SYNAP_HOST_LOOPBACK_PORT}`;
  }
  return resolveSynapUrl(secrets);
}

/**
 * Open a TCP connection to `host:port`, succeed if the SYN-ACK comes
 * back within `timeoutMs`, fail otherwise. Closes the socket immediately
 * — we don't care about the application protocol, only that something
 * is listening.
 */
function probeTcpPort(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new Socket();
    let settled = false;
    const settle = (result: boolean) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch { /* ignore */ }
      resolve(result);
    };

    const timer = setTimeout(() => settle(false), timeoutMs);
    timer.unref?.();

    socket.once("connect", () => {
      clearTimeout(timer);
      settle(true);
    });
    socket.once("error", () => {
      clearTimeout(timer);
      settle(false);
    });

    try {
      socket.connect(port, host);
    } catch {
      clearTimeout(timer);
      settle(false);
    }
  });
}
