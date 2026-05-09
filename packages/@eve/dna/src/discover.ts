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
import { readEveSecrets, writeEveSecrets, type EveSecrets } from "./secrets-contract.js";

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

export interface BackfilledPodConfig extends DiscoveredPodConfig {
  /** true when canonical pod config was written to secrets.json. */
  backfilled: boolean;
}

export interface DiscoverAndBackfillPodConfigOptions {
  /**
   * Write discovered canonical values into secrets.json. Defaults to true.
   * Set false for dry-run flows that still need to know what would be used.
   */
  backfill?: boolean;
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

/**
 * Domains that are install-time placeholders, not real hostnames.
 * Returning these as "discovered" would overwrite a real configured domain
 * in secrets.json with a useless default.
 */
const PLACEHOLDER_DOMAINS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "example.com",
  "yourdomain.com",
  "mydomain.com",
  "your-domain.com",
]);

function isPlaceholderDomain(d: string): boolean {
  if (!d) return true;
  const lower = d.toLowerCase();
  return (
    PLACEHOLDER_DOMAINS.has(lower) ||
    lower.startsWith("127.") ||
    lower.startsWith("192.168.") ||
    lower.startsWith("10.") ||
    !lower.includes(".")  // bare hostname with no TLD is never a real public domain
  );
}

function isPlaceholderUrl(url: string): boolean {
  try {
    return isPlaceholderDomain(new URL(url).hostname);
  } catch {
    return true;
  }
}

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

      // Only set synapUrl from PUBLIC_URL (an explicit full URL). When only
      // DOMAIN is known we do NOT build a synapUrl — the bare DOMAIN value
      // lacks the "pod." subdomain prefix that Traefik uses for routing. The
      // correct derived URL is `https://pod.${domain}`, which `resolveSynapUrl`
      // already knows how to derive from `domain.primary`. Writing a wrong URL
      // to secrets.synap.apiUrl here caused persistent 404s: the stored URL
      // bypassed the loopback probe in `resolveSynapUrlOnHost` and then hit
      // Traefik on a path with no route.
      const synapUrl =
        publicUrl && !isPlaceholderUrl(publicUrl)
          ? publicUrl.replace(/\/$/, "")
          : undefined;
      const realDomain =
        domain && !isPlaceholderDomain(domain) ? domain : undefined;

      if (synapUrl || realDomain || token) {
        return {
          domain: realDomain || (synapUrl ? new URL(synapUrl).hostname : undefined),
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

function probeTraefikConfig(): { domain?: string; source?: string } {
  if (!existsSync(TRAEFIK_DYNAMIC)) return {};
  try {
    const raw = readFileSync(TRAEFIK_DYNAMIC, "utf-8");
    // Look for Host(`pod.<domain>`) patterns — the backend service rule
    const matches = raw.match(/Host\(`[^`]+`\)/g) ?? [];
    for (const rule of matches) {
      const host = extractHostFromTraefikRule(rule);
      if (!host || host.startsWith("*.") || !host.includes(".")) continue;
      // Strip leading "pod." to get the bare domain stored in secrets.domain.primary
      const domain = host.startsWith("pod.") ? host.slice(4) : host;
      return { domain, source: TRAEFIK_DYNAMIC };
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
      // Same rule as probeEnvFiles: only set synapUrl from PUBLIC_URL.
      // DOMAIN alone doesn't carry the "pod." prefix needed for routing.
      // Also filter placeholder values that are install-time defaults.
      const synapUrl =
        publicUrl && !isPlaceholderUrl(publicUrl)
          ? publicUrl.replace(/\/$/, "")
          : undefined;
      const realDomain =
        domain && !isPlaceholderDomain(domain) ? domain : undefined;
      if (synapUrl || realDomain || token) {
        return {
          domain: realDomain || (synapUrl ? new URL(synapUrl).hostname : undefined),
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
  if (fromEnv.synapUrl || fromEnv.domain || fromEnv.provisioningToken) {
    synapUrl = fromEnv.synapUrl;
    domain = fromEnv.domain;
    provisioningToken = fromEnv.provisioningToken;
    if (fromEnv.source) sources.push(fromEnv.source);
  }

  if (!domain) {
    const fromTraefik = probeTraefikConfig();
    if (fromTraefik.domain) {
      domain = fromTraefik.domain;
      if (fromTraefik.source) sources.push(fromTraefik.source);
    }
  }

  if (!domain || !provisioningToken) {
    const fromDocker = probeDockerInspect();
    if (!synapUrl && fromDocker.synapUrl) {
      synapUrl = fromDocker.synapUrl;
    }
    if (!domain && fromDocker.domain) {
      domain = fromDocker.domain;
    }
    if (fromDocker.synapUrl || fromDocker.domain) {
      if (fromDocker.source && !sources.includes(fromDocker.source)) sources.push(fromDocker.source);
    }
    if (!provisioningToken && fromDocker.provisioningToken) {
      provisioningToken = fromDocker.provisioningToken;
      if (fromDocker.source && !sources.includes(fromDocker.source)) sources.push(fromDocker.source);
    }
  }

  return { synapUrl, domain, provisioningToken, sources };
}

function buildBackfillPatch(
  discovered: DiscoveredPodConfig,
  secrets: EveSecrets | null,
): Omit<EveSecrets, "version" | "updatedAt"> {
  if (!discovered.synapUrl && !discovered.domain) return {};

  const storedApiUrl = secrets?.synap?.apiUrl?.trim();
  const domainHostVariants = discovered.domain
    ? [
        `https://${discovered.domain}`,
        `http://${discovered.domain}`,
        `https://pod.${discovered.domain}`,
        `http://pod.${discovered.domain}`,
      ]
    : [];
  const shouldClearStoredUrl =
    storedApiUrl &&
    !discovered.synapUrl &&
    domainHostVariants.some((v) => storedApiUrl.startsWith(v));

  return {
    ...(discovered.domain ? { domain: { primary: discovered.domain } } : {}),
    ...(discovered.synapUrl
      ? { synap: { apiUrl: discovered.synapUrl } }
      : shouldClearStoredUrl
        ? { synap: { apiUrl: "" } }
        : {}),
  };
}

function patchHasValues(patch: Omit<EveSecrets, "version" | "updatedAt">): boolean {
  return Object.values(patch).some((value) => {
    if (!value || typeof value !== "object") return value !== undefined;
    return Object.keys(value).length > 0;
  });
}

/**
 * Discover canonical pod config from on-disk artifacts and backfill it into
 * secrets.json. `discoverPodConfig()` remains a read-only diagnostic probe;
 * operational callers that want canonical config should use this helper.
 *
 * Backfill rules:
 *   - `domain.primary` is written when a real domain is discovered.
 *   - `synap.apiUrl` is written only for an explicit PUBLIC_URL.
 *   - stale derived apiUrl values are cleared so URL resolution derives from
 *     `domain.primary` and can prefer the loopback transport on-host.
 */
export async function discoverAndBackfillPodConfig(
  cwd = process.cwd(),
  options: DiscoverAndBackfillPodConfigOptions = {},
): Promise<BackfilledPodConfig> {
  const discovered = discoverPodConfig();
  const shouldBackfill = options.backfill ?? true;

  if (!shouldBackfill || (!discovered.synapUrl && !discovered.domain)) {
    return { ...discovered, backfilled: false };
  }

  const secrets = await readEveSecrets(cwd);
  const patch = buildBackfillPatch(discovered, secrets);
  if (!patchHasValues(patch)) {
    return { ...discovered, backfilled: false };
  }

  await writeEveSecrets(patch, cwd);
  return { ...discovered, backfilled: true };
}

/**
 * Discover the pod URL from on-disk artifacts and write it back to
 * secrets.json as canonical config. This prevents future reads from falling
 * through to discovery — once backfilled, the URL is read from secrets.json
 * on all subsequent calls.
 *
 * Returns the discovered URL on success, or null if nothing was found
 * with an explicit URL.
 */
export async function discoverAndBackfillPodUrl(cwd = process.cwd()): Promise<string | null> {
  const discovered = await discoverAndBackfillPodConfig(cwd);
  if (discovered.synapUrl) return discovered.synapUrl;
  if (discovered.domain) return `https://pod.${discovered.domain}`;
  return null;
}
