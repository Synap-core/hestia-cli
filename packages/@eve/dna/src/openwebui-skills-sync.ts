/**
 * @eve/dna — Sync Synap system skills into OpenWebUI's "Prompts" feature.
 *
 * Synap's Hub Protocol exposes three system skill packages (synap, synap-schema,
 * synap-ui) under `GET /api/hub/skills/system`. Each contains a SKILL.md document
 * with full Hub Protocol documentation. We push the SKILL.md body of each package
 * as an OpenWebUI Prompt — surfacing them to users as system-prompt templates
 * they can pick from the OpenWebUI UI (`/synap`, `/synap-schema`, `/synap-ui`).
 *
 * Idempotent: re-running diffs the existing prompt content and only POSTs an
 * update when the SKILL.md actually changed. Per-skill failures are non-fatal
 * and reported via `skipped[]`; only top-level failures (admin login / Hub
 * fetch) throw.
 *
 * Auth pattern matches `openwebui-admin.ts` — we forge an admin JWT from
 * WEBUI_SECRET_KEY rather than performing an email/password login. The brief
 * mentioned email/password login but the existing codebase has standardised on
 * `getAdminJwt()` (which is purely local — reads the secret key off disk and
 * the admin row out of the SQLite DB), so we reuse that to avoid duplicating
 * a login flow that doesn't exist yet.
 *
 * OpenWebUI Prompts admin API endpoints (v0.x):
 *   GET    /api/v1/prompts/                      — list all prompts
 *   POST   /api/v1/prompts/create                — create a new prompt
 *   POST   /api/v1/prompts/command/{cmd}/update  — update an existing prompt
 *   DELETE /api/v1/prompts/command/{cmd}/delete  — delete a prompt
 */
import { COMPONENTS } from './components.js';
import { getAdminJwt } from './openwebui-admin.js';
import { readAgentKeyOrLegacy } from './secrets-contract.js';
import type { EveSecrets } from './secrets-contract.js';

/** OpenWebUI Prompt — system-prompt template surfaced as `/<command>` in the UI. */
export interface OpenwebuiPrompt {
  /** Slash-command slug (no leading slash). User types `/synap` to invoke. */
  command: string;
  title: string;
  content: string;
  /** OpenWebUI access-control object — null/undefined = visible to all. */
  access_control?: unknown;
}

/** One synced prompt corresponds to one Synap skill (SKILL.md content). */
export interface SyncedSkillPrompt {
  command: string;        // e.g. "synap" — the user types /synap to invoke
  title: string;          // human-readable name
  content: string;        // SKILL.md body (system prompt template)
  source: 'synap' | 'synap-schema' | 'synap-ui';
}

export interface SkillsSyncResult {
  synced: SyncedSkillPrompt[];
  created: number;
  updated: number;
  skipped: Array<{ command: string; reason: string }>;
}

/** Hub /skills/system response shape — matches what `ensureEveSkillsLayout` consumes. */
interface HubSkillPackage {
  slug: string;
  files: Array<{ path: string; content: string }>;
}

/** The three Synap system skill slugs we mirror into OpenWebUI. */
const SYNAP_SKILL_SLUGS = ['synap', 'synap-schema', 'synap-ui'] as const;
type SynapSkillSlug = (typeof SYNAP_SKILL_SLUGS)[number];

/** Tag baked into prompt titles so operators can spot Eve-managed entries. */
const EVE_MANAGED_TAG = 'synap:system';

/** Per-HTTP-call timeout matching `ensureEveSkillsLayout`. */
const HTTP_TIMEOUT_MS = 8000;

function resolveAdminUrl(hostPort?: number): string {
  const comp = COMPONENTS.find(c => c.id === 'openwebui');
  const port = hostPort ?? comp?.service?.hostPort ?? 3011;
  return `http://127.0.0.1:${port}`;
}

function titleFor(slug: SynapSkillSlug): string {
  switch (slug) {
    case 'synap':
      return `Synap — Capture, Memory, Channels [${EVE_MANAGED_TAG}]`;
    case 'synap-schema':
      return `Synap Schema — Profiles & Property Defs [${EVE_MANAGED_TAG}]`;
    case 'synap-ui':
      return `Synap UI — Views & Dashboards [${EVE_MANAGED_TAG}]`;
  }
}

/** Fetch the three Synap system skill packages from the pod's Hub Protocol. */
async function fetchSynapSkills(
  hubBaseUrl: string,
  apiKey: string,
): Promise<HubSkillPackage[]> {
  const res = await fetch(`${hubBaseUrl}/skills/system`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`Hub /skills/system failed with HTTP ${res.status}`);
  }
  const packages = (await res.json()) as HubSkillPackage[];
  if (!Array.isArray(packages)) {
    throw new Error('Hub /skills/system returned a non-array body');
  }
  return packages;
}

/** Pull the SKILL.md body out of a hub package (its files entries). */
function extractSkillMarkdown(pkg: HubSkillPackage): string | null {
  const file = pkg.files.find(f => f.path === 'SKILL.md');
  return file?.content ?? null;
}

/** GET /api/v1/prompts/ — returns the list of existing prompts. */
async function listPrompts(jwt: string, hostPort?: number): Promise<OpenwebuiPrompt[]> {
  const baseUrl = resolveAdminUrl(hostPort);
  const res = await fetch(`${baseUrl}/api/v1/prompts/`, {
    headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`OpenWebUI GET /api/v1/prompts/ failed with HTTP ${res.status}`);
  }
  const data = (await res.json()) as unknown;
  return Array.isArray(data) ? (data as OpenwebuiPrompt[]) : [];
}

/** POST /api/v1/prompts/create — creates a new prompt. */
async function createPrompt(
  jwt: string,
  prompt: OpenwebuiPrompt,
  hostPort?: number,
): Promise<void> {
  const baseUrl = resolveAdminUrl(hostPort);
  const res = await fetch(`${baseUrl}/api/v1/prompts/create`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(prompt),
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`POST /api/v1/prompts/create failed with HTTP ${res.status}`);
  }
}

/** POST /api/v1/prompts/command/{command}/update — updates an existing prompt. */
async function updatePrompt(
  jwt: string,
  prompt: OpenwebuiPrompt,
  hostPort?: number,
): Promise<void> {
  const baseUrl = resolveAdminUrl(hostPort);
  const path = `/api/v1/prompts/command/${encodeURIComponent(prompt.command)}/update`;
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(prompt),
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`POST ${path} failed with HTTP ${res.status}`);
  }
}

/**
 * Fetch /api/hub/skills/system using eve agent's Hub key, then upsert each
 * skill as an OpenWebUI prompt via admin API. Idempotent — re-running
 * updates content if SKILL.md changed, no-ops otherwise.
 */
export async function pushSynapSkillsToOpenwebuiPrompts(
  cwd: string,
  hubBaseUrl: string,
  secrets: EveSecrets,
): Promise<SkillsSyncResult> {
  // Hub auth — eve agent identity, with legacy single-key fallback (matches
  // the contract used by ensureEveSkillsLayout / writeBuilderProjectEnv).
  const apiKey = await readAgentKeyOrLegacy('eve', cwd);
  if (!apiKey) {
    throw new Error('No Hub API key available — secrets.agents.eve.hubApiKey is unset');
  }

  // Pull the canonical SKILL.md docs from the pod. A failure here aborts the
  // whole sync — we have nothing to push without them.
  const packages = await fetchSynapSkills(hubBaseUrl.replace(/\/$/, ''), apiKey);

  // OpenWebUI admin JWT — forged locally from WEBUI_SECRET_KEY + admin DB row.
  // A failure here is non-recoverable: there's no admin path without the JWT.
  const jwt = await getAdminJwt();
  if (!jwt) {
    throw new Error('OpenWebUI admin JWT unavailable — container down or no admin user');
  }

  // Snapshot existing prompts so we can diff content and decide create-vs-update.
  const existing = await listPrompts(jwt);
  const existingByCommand = new Map<string, OpenwebuiPrompt>();
  for (const p of existing) {
    if (typeof p.command === 'string') existingByCommand.set(p.command, p);
  }

  const synced: SyncedSkillPrompt[] = [];
  const skipped: Array<{ command: string; reason: string }> = [];
  let created = 0;
  let updated = 0;

  // Reference `secrets` so its presence is part of the contract for callers
  // that need to thread context through (e.g. future per-workspace tagging).
  // Currently we only need the eve agent key, which we already resolved above.
  void secrets;

  for (const slug of SYNAP_SKILL_SLUGS) {
    const pkg = packages.find(p => p.slug === slug);
    if (!pkg) {
      skipped.push({ command: slug, reason: 'Hub did not return this skill package' });
      continue;
    }
    const content = extractSkillMarkdown(pkg);
    if (!content) {
      skipped.push({ command: slug, reason: 'Skill package has no SKILL.md file' });
      continue;
    }

    const desired: OpenwebuiPrompt = {
      command: slug,
      title: titleFor(slug),
      content,
    };

    try {
      const prior = existingByCommand.get(slug);
      if (!prior) {
        await createPrompt(jwt, desired);
        created++;
      } else if (prior.content !== content || prior.title !== desired.title) {
        await updatePrompt(jwt, desired);
        updated++;
      }
      synced.push({
        command: slug,
        title: desired.title,
        content,
        source: slug,
      });
    } catch (err) {
      skipped.push({
        command: slug,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { synced, created, updated, skipped };
}
