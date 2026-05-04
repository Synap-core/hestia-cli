/**
 * Builder workspace seeder.
 *
 * Posts the Eve-bundled `builder-workspace.json` template to the user's
 * Synap pod via `POST /api/hub/workspaces/from-definition`. The pod
 * gates this endpoint behind an agentType allowlist (eve + coder), so
 * we authenticate with the eve agent's Hub key.
 *
 * Idempotency: the template carries `proposalId: "builder-workspace-v1"`,
 * which the backend uses as the dedupe key. Calling this function
 * repeatedly always resolves to the same workspace row — `created`
 * tells us whether THIS call produced it (vs. resolved an existing
 * one). On success we persist `workspaceId` to `secrets.builder.workspaceId`
 * for fast lookup; even if that write is lost, the next ensure call
 * resolves back to the same row through `proposalId`.
 *
 * Bundled template path: `assets/templates/builder-workspace.json`
 * relative to this package's install location. The source of truth is
 * `synap-backend/templates/builder-workspace.json`; the build-time sync
 * script `scripts/sync-builder-template.ts` copies it into our assets
 * dir. Eve must work without the synap-backend repo present at runtime
 * — never try to resolve the source repo here.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readEveSecrets, writeEveSecrets, type EveSecrets } from "@eve/dna";
import { FetchRunner, type IDoctorRunner } from "./diagnostics.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Subset of EveSecrets we need. Accept a partial blob so callers that
 * already loaded secrets.json once can reuse it without forcing another
 * file read inside this function.
 */
export interface EnsureBuilderWorkspaceOptions {
  /** Already-loaded secrets blob (we still re-read for the eve agent key). */
  secrets: EveSecrets | null;
  /** Pod URL (e.g. `http://127.0.0.1:4000` or `https://pod.example.com`). */
  podUrl: string;
  /**
   * Override the runner. Defaults to the same FetchRunner the
   * diagnostics path uses. Tests inject a fake.
   */
  runner?: IDoctorRunner;
  /** Working directory for secrets reads/writes. Defaults to EVE_HOME / cwd. */
  deployDir?: string;
  /** Hard wall-clock cap on the request. Default 15s — first call seeds many entities. */
  timeoutMs?: number;
}

export interface EnsureBuilderWorkspaceResult {
  workspaceId: string;
  /**
   * True when THIS call produced the workspace; false when the backend
   * resolved an existing one via `proposalId`.
   */
  created: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 15_000;

/** The agent slug whose Hub key authenticates the seeding call. */
const AUTH_AGENT_TYPE = "eve";

// ---------------------------------------------------------------------------
// Template loader
// ---------------------------------------------------------------------------

/**
 * Resolve the bundled template path. We look in three places to support
 * dev-from-source, tsup-built dist, and the dashboard's container image:
 *
 *   1. `<here>/../assets/templates/...` — built `dist/` sits next to `assets/`
 *   2. `<here>/assets/templates/...`     — tsup may co-locate when bundling
 *   3. `/app/packages/@eve/lifecycle/assets/templates/...` — container baked path
 *
 * Mirrors the resolution strategy in `copyReferencePipelines()` so all
 * Eve assets are loadable in the same set of environments.
 */
function resolveTemplatePath(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "..", "assets", "templates", "builder-workspace.json"),
    join(here, "assets", "templates", "builder-workspace.json"),
    "/app/packages/@eve/lifecycle/assets/templates/builder-workspace.json",
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * Read + parse the bundled template. Throws with a clear message when
 * the file is missing or malformed — `ensureBuilderWorkspace` lets the
 * error propagate so the caller can decide whether to fail the install.
 */
function loadBundledTemplate(): Record<string, unknown> {
  const path = resolveTemplatePath();
  if (!path) {
    throw new Error(
      "Builder workspace template not found in @eve/lifecycle assets. " +
        "Run `pnpm --filter @eve/lifecycle sync-builder-template` (or rebuild) " +
        "to copy it from synap-backend/templates/builder-workspace.json.",
    );
  }
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch (err) {
    throw new Error(
      `Could not read builder workspace template at ${path}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      throw new Error("template root is not a JSON object");
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    throw new Error(
      `Builder workspace template at ${path} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Main entry — ensureBuilderWorkspace
// ---------------------------------------------------------------------------

/**
 * Seed (or reconcile) the Builder workspace on the user's pod.
 *
 * Idempotent — the bundled template carries `proposalId:
 * "builder-workspace-v1"`; calling this twice resolves to the same
 * workspace row.
 *
 * Throws on failure (network, 401/403, 5xx, missing eve key, missing
 * template). Lifecycle hooks catch and downgrade — they should NOT
 * fail an install/update because of a workspace seed issue.
 */
export async function ensureBuilderWorkspace(
  opts: EnsureBuilderWorkspaceOptions,
): Promise<EnsureBuilderWorkspaceResult> {
  const podUrl = opts.podUrl.trim().replace(/\/+$/, "");
  if (!podUrl) {
    throw new Error("ensureBuilderWorkspace: podUrl is required");
  }

  // Read secrets fresh so we always pick up the latest eve agent key
  // (the key may have been minted in the same hook run, just before us).
  const cwd = opts.deployDir ?? process.env.EVE_HOME ?? process.cwd();
  const fresh = await readEveSecrets(cwd);
  const secrets = fresh ?? opts.secrets;
  const eveKey =
    secrets?.agents?.[AUTH_AGENT_TYPE]?.hubApiKey?.trim() ??
    // Legacy fallback: pre-migration installs only had the single key.
    secrets?.synap?.apiKey?.trim() ??
    "";
  if (!eveKey) {
    throw new Error(
      `ensureBuilderWorkspace: no eve agent Hub key found in secrets.json. ` +
        `Run \`eve auth provision\` against ${podUrl} first.`,
    );
  }

  const template = loadBundledTemplate();
  const proposalId =
    typeof template.proposalId === "string" ? template.proposalId : "(unset)";

  const runner = opts.runner ?? new FetchRunner();
  const url = `${podUrl}/api/hub/workspaces/from-definition`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${eveKey}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  const body = JSON.stringify(template);

  const res = await runner.httpPost(url, headers, body, {
    timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  });

  if (res.status === 0) {
    throw new Error(
      `ensureBuilderWorkspace: cannot reach ${url} (${res.error ?? "network error"})`,
    );
  }
  if (res.status === 401 || res.status === 403) {
    throw new Error(
      `ensureBuilderWorkspace: pod rejected the eve agent key with ${res.status}. ` +
        `Run \`eve auth status\` and \`eve auth renew --agent eve\` to recover.`,
    );
  }
  if (res.status === 404) {
    throw new Error(
      `ensureBuilderWorkspace: ${url} not available — backend version too old. ` +
        `Run \`eve update synap\`.`,
    );
  }
  if (res.status < 200 || res.status >= 300) {
    throw new Error(
      `ensureBuilderWorkspace: pod returned ${res.status} for proposalId=${proposalId}: ${res.body.slice(0, 200)}`,
    );
  }

  // 2xx — parse the success envelope.
  let parsed: unknown;
  try {
    parsed = JSON.parse(res.body);
  } catch {
    throw new Error(
      `ensureBuilderWorkspace: pod returned non-JSON body (status ${res.status}): ${res.body.slice(0, 160)}`,
    );
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error(
      `ensureBuilderWorkspace: pod response was not an object (status ${res.status})`,
    );
  }
  const obj = parsed as Record<string, unknown>;
  const workspaceId =
    typeof obj.workspaceId === "string" ? obj.workspaceId.trim() : "";
  if (!workspaceId) {
    throw new Error(
      `ensureBuilderWorkspace: pod response missing workspaceId (proposalId=${proposalId})`,
    );
  }
  const created = obj.created === true;

  // Persist for fast subsequent lookup. Failure here is non-fatal: the
  // pod already has the workspace, the next call will resolve through
  // proposalId, so we surface the warning via the caller's catch path.
  try {
    await writeEveSecrets(
      { builder: { workspaceId } },
      cwd,
    );
  } catch (err) {
    // Wrap rather than swallow so callers can distinguish "seed worked
    // but local state is stale" from "seed failed".
    throw new Error(
      `ensureBuilderWorkspace: pod seeded ${workspaceId} but secrets.json write failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  return { workspaceId, created };
}
