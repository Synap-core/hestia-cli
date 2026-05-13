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
 * OpenWebUI Prompts admin API endpoints (v0.9.4):
 *   GET    /api/v1/prompts/                      — list all prompts (each carries `id`)
 *   POST   /api/v1/prompts/create                — create a new prompt
 *   POST   /api/v1/prompts/id/{id}/update        — update an existing prompt (NEW in v0.9)
 *   DELETE /api/v1/prompts/id/{id}/delete        — delete a prompt
 *
 * Migration note: pre-v0.9 had `POST /api/v1/prompts/command/{cmd}/update`.
 * v0.9.4 removed the command-keyed update; we look the id up from the list
 * response and use it for both update and delete.
 */
import { getAdminJwt, resolveOpenwebuiAdminUrl } from './openwebui-admin.js';
import { readAgentKeyOrLegacy } from './secrets-contract.js';
import type { EveSecrets } from './secrets-contract.js';

/**
 * OpenWebUI Prompt — system-prompt template surfaced as `/<command>` in the UI.
 *
 * Field layout matches v0.9.4's `PromptForm` Pydantic model
 * (`backend/open_webui/models/prompts.py`). Pre-v0.9 used `title`; v0.9
 * renamed it to `name`. We send `name` so create/update don't 422.
 */
export interface OpenwebuiPrompt {
  /** OWUI's database row id — present on list responses, absent on creates. */
  id?: string;
  /** Slash-command slug (no leading slash). User types `/synap` to invoke. */
  command: string;
  /** Human-readable label shown in the picker (renamed from `title` in v0.9). */
  name: string;
  content: string;
  /** OpenWebUI access-control object — null/undefined = visible to all. */
  access_control?: unknown;
}

/** One synced prompt corresponds to one Synap skill (SKILL.md content). */
export interface SyncedSkillPrompt {
  command: string;        // e.g. "synap" — the user types /synap to invoke
  name: string;           // human-readable label (PromptForm.name in v0.9.4)
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

function nameFor(slug: SynapSkillSlug): string {
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
  const baseUrl = resolveOpenwebuiAdminUrl(hostPort);
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
  const baseUrl = resolveOpenwebuiAdminUrl(hostPort);
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

/**
 * POST /api/v1/prompts/id/{id}/update — updates an existing prompt.
 *
 * v0.9.4 removed the older command-keyed update endpoint
 * (`/api/v1/prompts/command/{cmd}/update`). The id comes from the list
 * response (`GET /api/v1/prompts/`); each entry carries an `id`.
 */
async function updatePrompt(
  jwt: string,
  promptId: string,
  prompt: OpenwebuiPrompt,
  hostPort?: number,
): Promise<void> {
  const baseUrl = resolveOpenwebuiAdminUrl(hostPort);
  const path = `/api/v1/prompts/id/${encodeURIComponent(promptId)}/update`;
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
  // Hub auth — prefer the `openwebui` agent identity so this sync has its
  // own audit trail / rotation. Pre-migration installs fall back to the
  // eve agent (always-on) so older deploys keep working without re-running
  // provisioning. Empty string means neither slot is provisioned.
  let apiKey = await readAgentKeyOrLegacy('openwebui', cwd);
  if (!apiKey) apiKey = await readAgentKeyOrLegacy('eve', cwd);
  if (!apiKey) {
    throw new Error('No Hub API key available — run: eve auth provision --agent openwebui (or eve auth provision --agent eve)');
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
      name: nameFor(slug),
      content,
    };

    try {
      const prior = existingByCommand.get(slug);
      if (!prior) {
        await createPrompt(jwt, desired);
        created++;
      } else if (prior.content !== content || prior.name !== desired.name) {
        if (!prior.id) {
          // OWUI ≥ v0.9 returns id on every prompt; older builds may not.
          // Without an id we can't target the new update endpoint.
          skipped.push({
            command: slug,
            reason: 'existing prompt missing `id` field — cannot target id-keyed update endpoint',
          });
          continue;
        }
        await updatePrompt(jwt, prior.id, desired);
        updated++;
      }
      synced.push({
        command: slug,
        name: desired.name,
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
