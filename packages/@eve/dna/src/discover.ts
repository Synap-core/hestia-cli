/**
 * Pod config auto-discovery.
 *
 * Reads on-disk artefacts that the synap-backend stack writes during its
 * own setup — `.env` files, Traefik dynamic config, docker inspect output
 * — so the CLI can self-configure `~/.eve/secrets.json` without asking
 * the user for values that are already on disk.
 *
 * Discovery is a best-effort scan: each probe is tried in order, the
 * first hit wins, and the function never throws (unknown envs → undefined
 * fields). Call sites must tolerate partial results.
 */

import { existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DiscoveredPodConfig {
  /** Full URL to reach the synap-backend, e.g. "https://pod.example.com". */
  synapUrl?: string;
  /** Bare domain without scheme, e.g. "pod.example.com". */
  domain?: string;
  /** PROVISIONING_TOKEN value found in an .env file. */
  provisioningToken?: string;
  /** Human-readable note on where the values were found. */
  sources: string[];
}

// ---------------------------------------------------------------------------
// .env file paths to probe (in priority order)
// ---------------------------------------------------------------------------

const ENV_PATHS = [
  "/opt/synap-backend/.env",
  "/opt/synap-backend/deploy/.env",
  "/opt/synap-backend/.env.local",
];

// Traefik dynamic config path written by `eve legs domain`.
const TRAEFIK_DYNAMIC = "/opt/traefik/dynamic/eve-routes.yml";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse a KEY=VALUE env file into a plain object. Handles:
 *   - `#` comments
 *   - quoted values (`KEY="..."` or `KEY='...'`)
 *   - export prefix (`export KEY=VALUE`)
 *   - blank lines
 */
function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const withoutExport = line.startsWith("export ") ? line.slice(7) : line;
    const eqIdx = withoutExport.indexOf("=");
    if (eqIdx < 1) continue;
    const key = withoutExport.slice(0, eqIdx).trim();
    let val = withoutExport.slice(eqIdx + 1).trim();
    // Strip surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key) result[key] = val;
  }
  return result;
}

/** Extract `Host(`domain`)` from a Traefik YAML rule string. */
function extractHostFromTraefikRule(rule: string): string | undefined {
  const m = rule.match(/Host\(`([^`]+)`\)/);
  return m?.[1];
}

// ---------------------------------------------------------------------------
// Individual probes
// ---------------------------------------------------------------------------

function probeEnvFiles(): {
  domain?: string;
  synapUrl?: string;
  provisioningToken?: string;
  source?: string;
} {
  for (const path of ENV_PATHS) {
    if (!existsSync(path)) continue;
    try {
      const env = parseEnvFile(readFileSync(path, "utf-8"));
      const domain = env["DOMAIN"]?.trim();
      const publicUrl = env["PUBLIC_URL"]?.trim();
      const token = env["PROVISIONING_TOKEN"]?.trim();

      let synapUrl: string | undefined;
      if (publicUrl) {
        synapUrl = publicUrl.replace(/\/$/, "");
      } else if (domain) {
        // Assume HTTPS (Traefik terminates TLS on all Eve deployments).
        synapUrl = `https://${domain}`;
      }

      if (synapUrl || token) {
        return {
          domain: domain || (synapUrl ? new URL(synapUrl).hostname : undefined),
          synapUrl,
          provisioningToken: token || undefined,
          source: path,
        };
      }
    } catch {
      // Unreadable file — try next
    }
  }
  return {};
}

function probeTraefikConfig(): { domain?: string; synapUrl?: string; source?: string } {
  if (!existsSync(TRAEFIK_DYNAMIC)) return {};
  try {
    const raw = readFileSync(TRAEFIK_DYNAMIC, "utf-8");
    // Look for Host(`...`) patterns in the YAML text
    const matches = raw.match(/Host\(`[^`]+`\)/g) ?? [];
    for (const rule of matches) {
      const domain = extractHostFromTraefikRule(rule);
      // Skip wildcard or internal rules
      if (domain && !domain.startsWith("*.") && domain.includes(".")) {
        return {
          domain,
          synapUrl: `https://${domain}`,
          source: TRAEFIK_DYNAMIC,
        };
      }
    }
  } catch {
    // Ignore
  }
  return {};
}

function probeDockerInspect(): {
  domain?: string;
  synapUrl?: string;
  provisioningToken?: string;
  source?: string;
} {
  // Common container names the backend might run as
  const candidates = [
    "synap-backend-backend-1",
    "synap-backend_backend_1",
    "backend",
  ];

  for (const name of candidates) {
    try {
      const out = execSync(
        `docker inspect ${name} --format '{{json .Config.Env}}'`,
        { stdio: ["ignore", "pipe", "ignore"], timeout: 3000 },
      )
        .toString()
        .trim();
      if (!out) continue;
      const envArr: string[] = JSON.parse(out);
      const envMap: Record<string, string> = {};
      for (const entry of envArr) {
        const idx = entry.indexOf("=");
        if (idx > 0) envMap[entry.slice(0, idx)] = entry.slice(idx + 1);
      }
      const domain = envMap["DOMAIN"]?.trim();
      const publicUrl = envMap["PUBLIC_URL"]?.trim();
      const token = envMap["PROVISIONING_TOKEN"]?.trim();
      let synapUrl = publicUrl?.replace(/\/$/, "") ||
        (domain ? `https://${domain}` : undefined);
      if (synapUrl || token) {
        return {
          domain: domain || (synapUrl ? new URL(synapUrl).hostname : undefined),
          synapUrl,
          provisioningToken: token || undefined,
          source: `docker inspect ${name}`,
        };
      }
    } catch {
      // Container not found or docker not available — try next
    }
  }
  return {};
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Discover synap-backend configuration from on-disk artefacts.
 *
 * Probes (in order, first wins per field):
 *   1. `.env` files in `/opt/synap-backend/`
 *   2. Traefik dynamic config at `/opt/traefik/dynamic/eve-routes.yml`
 *   3. `docker inspect` of a running backend container
 *
 * Never throws. Returns partial results when only some fields are found.
 */
export function discoverPodConfig(): DiscoveredPodConfig {
  const sources: string[] = [];
  let synapUrl: string | undefined;
  let domain: string | undefined;
  let provisioningToken: string | undefined;

  const fromEnv = probeEnvFiles();
  if (fromEnv.synapUrl || fromEnv.provisioningToken) {
    synapUrl = fromEnv.synapUrl;
    domain = fromEnv.domain;
    provisioningToken = fromEnv.provisioningToken;
    sources.push(fromEnv.source!);
  }

  if (!synapUrl) {
    const fromTraefik = probeTraefikConfig();
    if (fromTraefik.synapUrl) {
      synapUrl = fromTraefik.synapUrl;
      domain = domain ?? fromTraefik.domain;
      sources.push(fromTraefik.source!);
    }
  }

  if (!synapUrl || !provisioningToken) {
    const fromDocker = probeDockerInspect();
    if (!synapUrl && fromDocker.synapUrl) {
      synapUrl = fromDocker.synapUrl;
      domain = domain ?? fromDocker.domain;
      sources.push(fromDocker.source!);
    }
    if (!provisioningToken && fromDocker.provisioningToken) {
      provisioningToken = fromDocker.provisioningToken;
      if (!sources.includes(fromDocker.source!)) sources.push(fromDocker.source!);
    }
  }

  return { synapUrl, domain, provisioningToken, sources };
}
