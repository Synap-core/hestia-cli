/**
 * Backend preflight — auto-configure and verify prerequisites before any
 * command that needs to talk to the synap-backend.
 *
 * The philosophy: every command that depends on the backend should call
 * `runBackendPreflight()` first. Preflight:
 *
 *   1. Checks whether we already have a working URL (fast path — no-op
 *      when the CLI is already configured).
 *   2. If not, auto-discovers pod config from on-disk artefacts (.env
 *      files, Traefik dynamic config, `docker inspect`) and writes the
 *      discovered values into `~/.eve/secrets.json`.
 *   3. Ensures the Eve-managed compose override (loopback port + eve-
 *      network) is in place so the CLI can talk to the backend without
 *      going through the public domain.
 *   4. Ensures a PROVISIONING_TOKEN exists in the pod's .env and is
 *      loaded into the running backend.
 *
 * All steps are idempotent. Running preflight on an already-configured
 * host is a series of cheap file-existence + TCP-probe checks that
 * complete in well under a second.
 */

import {
  readEveSecrets,
  writeEveSecrets,
  resolveSynapUrl,
  resolveSynapUrlOnHost,
  resetSynapLoopbackProbeCache,
  isSynapLoopbackReachable,
  ensureSynapLoopbackOverride,
  connectTraefikToEveNetwork,
  discoverAndBackfillPodConfig,
  findPodDeployDir,
  restartBackendContainer,
} from "@eve/dna";

import {
  ensurePodProvisioningToken,
  type EnsureProvisioningTokenResult,
} from "./auth.js";
import { migrateSetupProfileToSecrets } from "./setup-profile-migration.js";

// Placeholder domains written by the synap-backend defaults that must never
// land in secrets.json as the configured domain. If we detect one stored from
// a previous buggy preflight run, we clear it so the user is not stuck with
// *.localhost Traefik routes.
const PREFLIGHT_PLACEHOLDER_DOMAINS = new Set([
  "localhost", "127.0.0.1", "::1",
  "example.com", "yourdomain.com", "mydomain.com", "your-domain.com",
]);

function isPreflightPlaceholderDomain(d: string | undefined): boolean {
  if (!d) return false;
  const lower = d.toLowerCase();
  return (
    PREFLIGHT_PLACEHOLDER_DOMAINS.has(lower) ||
    lower.startsWith("127.") ||
    lower.startsWith("192.168.") ||
    lower.startsWith("10.") ||
    !lower.includes(".")
  );
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PreflightResult {
  /** URL to reach the synap-backend. Always set on success. */
  synapUrl: string;
  /** PROVISIONING_TOKEN, either from discovery or freshly generated. */
  provisioningToken: string;
  /**
   * true when preflight had to write/update secrets.json or generate a
   * token. The caller may want to print a note so the operator knows
   * what was auto-configured.
   */
  configured: boolean;
  /**
   * Human-readable summary of what was discovered / fixed, suitable for
   * printing as preflight output lines. Empty when the CLI was already
   * fully configured.
   */
  notes: string[];
}

export interface PreflightOptions {
  /**
   * Directory used by `writeEveSecrets`. Defaults to `process.cwd()` —
   * the same convention as the rest of the CLI.
   */
  cwd?: string;
  /**
   * Path to the synap-backend checkout on this host. Used to locate the
   * compose file when writing the loopback override.
   *
   * Defaults to `/opt/synap-backend`.
   */
  synapBackendDir?: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Wait up to `maxMs` for the loopback port to become reachable,
 * polling every `intervalMs`. Returns true once reachable.
 */
async function waitForLoopback(maxMs = 8_000, intervalMs = 500): Promise<boolean> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    resetSynapLoopbackProbeCache();
    if (await isSynapLoopbackReachable()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  resetSynapLoopbackProbeCache();
  return await isSynapLoopbackReachable();
}

// ---------------------------------------------------------------------------
// Main entrypoint
// ---------------------------------------------------------------------------

/**
 * Run all prerequisite checks for backend-dependent commands.
 *
 * @throws {Error} when preflight cannot resolve a working backend URL
 *   (e.g. fresh host, no synap-backend deployed yet). The error message
 *   is human-readable and suitable for printing directly to the user.
 */
export async function runBackendPreflight(
  opts: PreflightOptions = {},
): Promise<PreflightResult> {
  const cwd = opts.cwd ?? process.cwd();
  const synapBackendDir = opts.synapBackendDir ?? findPodDeployDir() ?? "/opt/synap-backend";
  const notes: string[] = [];
  let configured = false;

  // ------------------------------------------------------------------
  // Step 0: Catch up secrets from `.eve/setup-profile.json`.
  //
  // The setup wizard writes the user's domain answer to `setup-profile.json`
  // (under `domainHint`) but the runtime canonical store is `secrets.json`
  // (`domain.primary`). The two used to drift because the migration that
  // copies wizard answers → secrets was exported but never invoked. As a
  // result, `secrets.json` could hold `domain: null` even on a working pod
  // — making `resolveHubBaseUrl` / `resolveSynapUrl` return empty and
  // silently skipping every downstream push (skills / knowledge / tools).
  //
  // Run idempotently on every preflight so the canonical store always
  // reflects the wizard answer; no-op when secrets already has the field.
  // ------------------------------------------------------------------
  try {
    await migrateSetupProfileToSecrets(cwd);
  } catch {
    // Non-fatal — preflight will still proceed with whatever secrets has.
    // A loud failure here would block install/update on cosmetic issues.
  }

  // ------------------------------------------------------------------
  // Step 1: Fast path — check if the CLI is already configured and the
  // loopback is already reachable. This is the common case on a working
  // server.
  // ------------------------------------------------------------------

  let secrets = await readEveSecrets(cwd);

  // If a previous buggy preflight wrote a placeholder domain (e.g. "localhost"
  // from synap-backend's default .env) into secrets, clear it now so it doesn't
  // cascade into Traefik route generation with wrong hostnames.
  if (isPreflightPlaceholderDomain(secrets?.domain?.primary)) {
    secrets = await writeEveSecrets({ domain: { primary: undefined } }, cwd);
    notes.push("Cleared placeholder domain from secrets (was set to a default value — re-run `eve domain set` to configure)");
    configured = true;
  }

  let synapUrl = await resolveSynapUrlOnHost(secrets);

  // Fast path: ONLY when the resolved URL is the loopback (127.0.0.1 / localhost).
  // A public URL (pod.domain.com) means the loopback isn't bound yet — we must
  // still run the loopback setup steps (override write + backend restart) so the
  // CLI gets a direct path to the backend on future calls. Triggering the fast path
  // on a public URL causes the compose override to never be written.
  const isLoopback = synapUrl
    ? synapUrl.includes("127.0.0.1") || synapUrl.includes("localhost")
    : false;

  if (synapUrl && isLoopback) {
    // Loopback confirmed reachable — truly fast path.
    const tokenResult = await ensurePodProvisioningToken();
    const provisioningToken = tokenResult.token;
    if (!provisioningToken) {
      throw new Error(
        "Backend reachable but PROVISIONING_TOKEN is missing. " +
          "Set PROVISIONING_TOKEN in /opt/synap-backend/.env and restart the backend.",
      );
    }
    if (tokenResult.source === "generated") {
      notes.push(`Generated PROVISIONING_TOKEN → ${tokenResult.writtenTo ?? synapBackendDir}/.env`);
      configured = true;
    }
    return { synapUrl, provisioningToken, configured, notes };
  }

  // ------------------------------------------------------------------
  // Step 2: Auto-discover pod config from on-disk artefacts.
  // ------------------------------------------------------------------

  const discovered = await discoverAndBackfillPodConfig(cwd);

  if (discovered.backfilled) {
    secrets = await readEveSecrets(cwd);
    configured = true;
    notes.push(
      `Auto-configured pod: domain=${discovered.domain ?? "(unchanged)"}` +
        (discovered.synapUrl ? `, url=${discovered.synapUrl}` : "") +
        (discovered.sources.length > 0 ? ` (from ${discovered.sources.join(", ")})` : ""),
    );
  }

  // ------------------------------------------------------------------
  // Step 3: Ensure the Eve loopback compose override is in place. This
  // publishes 127.0.0.1:4000 → backend:4000 so we can bypass Traefik.
  // ------------------------------------------------------------------

  try {
    const overrideResult = ensureSynapLoopbackOverride(synapBackendDir);
    if (overrideResult.outcome === "wrote") {
      notes.push(`Wrote compose override (loopback + eve-network) → ${overrideResult.path}`);
      configured = true;

      // Bring the backend up with the new override so port 4000 is bound.
      const restarted = restartBackendContainer(synapBackendDir);
      notes.push(restarted
        ? "Restarted backend to apply compose override"
        : "Could not restart backend automatically — run: docker compose up -d backend");
    }
  } catch {
    notes.push("Could not write compose override (non-fatal, will use public URL)");
  }

  // ------------------------------------------------------------------
  // Step 4: Connect Traefik to eve-network (idempotent).
  // ------------------------------------------------------------------

  const traefik = connectTraefikToEveNetwork();
  if (traefik.connected && traefik.containerName && !traefik.alreadyConnected) {
    notes.push(`Connected ${traefik.containerName} to eve-network`);
    configured = true;
  }

  // ------------------------------------------------------------------
  // Step 5: Wait briefly for the loopback to come up (in case we just
  // restarted the backend).
  // ------------------------------------------------------------------

  const loopbackReady = await waitForLoopback(8_000);
  resetSynapLoopbackProbeCache(); // Reset so the next probe re-checks

  // ------------------------------------------------------------------
  // Step 6: Resolve the final URL (loopback if ready, else public URL).
  // ------------------------------------------------------------------

  secrets = await readEveSecrets(cwd);
  synapUrl = await resolveSynapUrlOnHost(secrets);

  if (!synapUrl) {
    // Last resort: try the discovered URL even if we can't probe TCP.
    synapUrl = discovered.synapUrl ?? resolveSynapUrl(secrets);
  }

  if (!synapUrl) {
    throw new Error(
      "Could not resolve synap-backend URL.\n" +
        "  • If synap-backend is installed, check that it's running: docker ps\n" +
        "  • Set DOMAIN or PUBLIC_URL in /opt/synap-backend/.env\n" +
        "  • Or run `eve setup` to configure this server from scratch",
    );
  }

  // ------------------------------------------------------------------
  // Step 7: Ensure PROVISIONING_TOKEN exists.
  // ------------------------------------------------------------------

  let tokenResult: EnsureProvisioningTokenResult;
  try {
    tokenResult = await ensurePodProvisioningToken();
  } catch (err) {
    throw new Error(
      `Cannot resolve PROVISIONING_TOKEN: ${err instanceof Error ? err.message : String(err)}\n` +
        "  Set PROVISIONING_TOKEN in /opt/synap-backend/.env",
    );
  }

  const provisioningToken = tokenResult.token;
  if (!provisioningToken) {
    throw new Error(
      "PROVISIONING_TOKEN is empty after all discovery attempts.\n" +
        "  Set PROVISIONING_TOKEN in /opt/synap-backend/.env and run `eve auth provision`",
    );
  }

  if (tokenResult.source === "generated") {
    notes.push(`Generated PROVISIONING_TOKEN → ${tokenResult.writtenTo ?? synapBackendDir}/.env`);
    configured = true;
  }

  if (!loopbackReady && synapUrl.includes("127.0.0.1")) {
    notes.push("Loopback not reachable yet — backend may still be starting (will retry on next command)");
  }

  return { synapUrl, provisioningToken, configured, notes };
}
