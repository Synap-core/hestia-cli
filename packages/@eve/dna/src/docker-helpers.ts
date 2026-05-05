/**
 * Shared Docker helpers used by both the lifecycle engine (@eve/lifecycle)
 * and the preflight system. Keeping them here avoids circular deps and
 * ensures the same container name lists, timeout values, and fallback
 * strategies are applied uniformly across all callers.
 */

import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Pod deploy directory resolution
// ---------------------------------------------------------------------------

/**
 * Directories we probe when looking for the synap-backend deploy dir.
 * Order matters — first match wins. The env override is checked before
 * this list in `findPodDeployDir()`.
 */
export const POD_DEPLOY_DIR_CANDIDATES: ReadonlyArray<string> = [
  "/opt/synap-backend/deploy",
  "/opt/synap-backend",
  "/opt/synap/deploy",
  "/opt/synap",
  "/opt/synap-pod/deploy",
  "/opt/synap-pod",
  "/srv/synap-backend/deploy",
  "/srv/synap/deploy",
];

/**
 * Locate the pod's deploy directory — the one that owns the .env we
 * manage and the compose files we run against.
 *
 * - `SYNAP_DEPLOY_DIR` env var always wins (operator override).
 * - Otherwise walks `POD_DEPLOY_DIR_CANDIDATES` and returns the first dir
 *   that has a docker-compose file present.
 */
export function findPodDeployDir(): string | null {
  if (process.env.SYNAP_DEPLOY_DIR && existsSync(process.env.SYNAP_DEPLOY_DIR)) {
    return process.env.SYNAP_DEPLOY_DIR;
  }
  for (const dir of POD_DEPLOY_DIR_CANDIDATES) {
    if (!existsSync(dir)) continue;
    if (
      existsSync(join(dir, "docker-compose.yml")) ||
      existsSync(join(dir, "docker-compose.standalone.yml"))
    ) {
      return dir;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Backend container restart
// ---------------------------------------------------------------------------

/** Known container names for the synap-backend service. */
export const SYNAP_BACKEND_CONTAINERS: ReadonlyArray<string> = [
  "synap-backend-backend-1",
  "synap-backend",
  "synap-backend-1",
];

/**
 * Restart the synap-backend container so it reloads its env.
 *
 * Strategy (first success wins, failures are non-fatal):
 *   1. `docker compose -f docker-compose.yml up -d backend`
 *   2. `docker compose -f docker-compose.standalone.yml up -d backend`
 *   3. `docker restart <container>` for each known container name
 *
 * Returns `true` if any strategy succeeded, `false` if all failed.
 * Never throws.
 */
export function restartBackendContainer(deployDir: string): boolean {
  const mainFile = join(deployDir, "docker-compose.yml");
  const standaloneFile = join(deployDir, "docker-compose.standalone.yml");
  const overrideFile = join(deployDir, "docker-compose.override.yml");
  const hasOverride = existsSync(overrideFile);

  // For docker-compose.yml: run WITHOUT -f so Docker Compose auto-discovers
  // docker-compose.override.yml in the same directory. Specifying -f
  // explicitly suppresses the override — the port mapping never gets applied.
  if (existsSync(mainFile)) {
    try {
      execSync("docker compose up -d backend", {
        cwd: deployDir,
        stdio: ["ignore", "ignore", "ignore"],
        timeout: 30_000,
      });
      return true;
    } catch {
      // fall through to standalone path
    }
  }

  // For standalone (non-default filename): compose won't auto-discover it,
  // so we must specify both files explicitly when the override exists.
  if (existsSync(standaloneFile)) {
    try {
      const overrideArg = hasOverride ? ` -f ${overrideFile}` : "";
      execSync(`docker compose -f ${standaloneFile}${overrideArg} up -d backend`, {
        cwd: deployDir,
        stdio: ["ignore", "ignore", "ignore"],
        timeout: 30_000,
      });
      return true;
    } catch {
      // fall through to docker restart
    }
  }

  for (const container of SYNAP_BACKEND_CONTAINERS) {
    try {
      execSync(`docker restart ${container}`, {
        stdio: ["ignore", "ignore", "ignore"],
        timeout: 15_000,
      });
      return true;
    } catch {
      // try next
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// Traefik → eve-network
// ---------------------------------------------------------------------------

export interface ConnectTraefikResult {
  /** true when a Traefik container was found and is now on eve-network. */
  connected: boolean;
  /** Name of the container we found (whether already connected or freshly joined). */
  containerName?: string;
  /** true when the container was already on eve-network before we tried. */
  alreadyConnected: boolean;
}

/** Traefik container names to probe, in priority order. */
const TRAEFIK_CANDIDATES = [
  "eve-legs-traefik",    // Eve-managed standard install
  "traefik-traefik-1",  // /opt/traefik compose project
  "traefik_traefik_1",  // older Docker Compose naming
  "traefik",            // bare hand-installed container
];

/**
 * Find the running Traefik container and connect it to `eve-network` so
 * it can route traffic to the backend.
 *
 * Idempotent: "already connected" is treated as success.
 * Never throws — returns `{ connected: false }` when no Traefik found.
 */
export function connectTraefikToEveNetwork(): ConnectTraefikResult {
  // First: probe via image ancestor filter to handle any project name.
  let candidates = [...TRAEFIK_CANDIDATES];
  try {
    const out = execSync(
      'docker ps --filter "ancestor=traefik" --filter "status=running" --format "{{.Names}}"',
      { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"], timeout: 4_000 },
    ).trim();
    const imageMatch = out.split("\n")[0]?.trim();
    if (imageMatch) candidates = [imageMatch, ...candidates];
  } catch {
    // docker unavailable or no traefik image running
  }

  for (const name of candidates) {
    // Verify the container exists and is running.
    try {
      execSync(`docker inspect --format "{{.State.Running}}" ${name}`, {
        stdio: ["ignore", "ignore", "ignore"],
        timeout: 2_000,
      });
    } catch {
      continue; // not found — try next
    }

    // Container is running — attempt network connect.
    try {
      execSync(`docker network connect eve-network ${name}`, {
        stdio: ["ignore", "ignore", "ignore"],
        timeout: 5_000,
      });
      return { connected: true, containerName: name, alreadyConnected: false };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isAlready =
        msg.includes("already exists") || msg.toLowerCase().includes("already connected");
      return { connected: true, containerName: name, alreadyConnected: isAlready };
    }
  }

  return { connected: false, alreadyConnected: false };
}
