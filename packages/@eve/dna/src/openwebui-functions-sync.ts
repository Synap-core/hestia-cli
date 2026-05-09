/**
 * @eve/dna — Sync Synap Filter Functions into OpenWebUI's native Functions
 * registry, replacing the standalone Pipelines container.
 *
 * Why Functions, not Pipelines:
 *   - Functions live in OWUI's own Python process (no extra container)
 *   - Storage is OWUI's SQLite, no separate `.env` to keep in sync
 *   - Admin lifecycle is the same JWT flow we already use for Prompts
 *   - The Pipelines container framework is being deprecated in favour of
 *     Functions across OWUI's roadmap; we get there one upgrade earlier.
 *
 * Two filters are managed here:
 *   - `synap_memory_filter` — inline memory + entity injection on every turn
 *   - `synap_channel_sync`  — mirrors every chat to a Synap thread (one-way)
 *
 * The other six pipelines that used to live in the Pipelines container all
 * duplicate Hub Protocol operations the model can already call via the
 * registered OpenAPI tool server (`/api/hub/openapi.json`); they're dropped
 * rather than ported. See `openwebui-functions-sync.test.ts` for the
 * upgrade contract.
 *
 * v0.9.4 admin endpoints used:
 *   GET    /api/v1/functions/                    → list (admin)
 *   POST   /api/v1/functions/create              → create
 *   POST   /api/v1/functions/id/{id}/update      → update body
 *   POST   /api/v1/functions/id/{id}/valves/update → set valves (URL/key)
 *   POST   /api/v1/functions/id/{id}/toggle      → enable / disable
 *   POST   /api/v1/functions/id/{id}/toggle/global → make filter run for all models
 *
 * Idempotency:
 *   - List once, diff content + name + valves, only POST what changed.
 *   - Toggle endpoints flip state — only call when current state differs.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { SYNAP_BACKEND_INTERNAL_URL } from './components.js';
import { getAdminJwt, resolveOpenwebuiAdminUrl } from './openwebui-admin.js';
import { readAgentKeyOrLegacy, type EveSecrets } from './secrets-contract.js';

// ── Public types ────────────────────────────────────────────────────────

export interface FunctionsSyncResult {
  synced: Array<{
    id: string;
    name: string;
    action: 'created' | 'updated' | 'unchanged';
    enabled: boolean;
    global: boolean;
  }>;
  skipped: Array<{ id: string; reason: string }>;
}

/** Inventory of Filter Functions we manage. Adding a new filter = one entry. */
const FUNCTION_DEFINITIONS = [
  {
    id: 'synap_memory_filter',
    name: 'Synap Memory Injection',
    file: 'synap_memory_filter.py',
    description:
      'Pre-prompt RAG: pulls top memories + entities from Synap on every turn.',
  },
  {
    id: 'synap_channel_sync',
    name: 'Synap Channel Sync',
    file: 'synap_channel_sync.py',
    description:
      'One-way mirror: every Open WebUI chat is posted to a Synap thread.',
  },
] as const;

// ── Internal types ──────────────────────────────────────────────────────

interface OpenwebuiFunctionRecord {
  id: string;
  user_id?: string;
  name: string;
  type?: string;
  content: string;
  meta?: { description?: string; manifest?: Record<string, unknown> };
  is_active?: boolean;
  is_global?: boolean;
  updated_at?: number;
  created_at?: number;
}

interface OpenwebuiFunctionForm {
  id: string;
  name: string;
  content: string;
  meta: { description?: string; manifest?: Record<string, unknown> };
}

const HTTP_TIMEOUT_MS = 8000;

// ── Asset loading ───────────────────────────────────────────────────────

/**
 * Locate the `assets/functions/` directory. We try the same candidate set
 * that `@eve/lifecycle`'s `copyReferencePipelines` uses so the lookup
 * works in dev (`packages/@eve/dna/assets`), in the published package
 * (`dist/` next to `assets/`), and in the deployed container layout.
 */
function resolveAssetsDir(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, '..', 'assets', 'functions'),
    join(here, 'assets', 'functions'),
    '/app/packages/@eve/dna/assets/functions',
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

function readFunctionSource(filename: string): string | null {
  const dir = resolveAssetsDir();
  if (!dir) return null;
  const p = join(dir, filename);
  if (!existsSync(p)) return null;
  return readFileSync(p, 'utf-8');
}

// ── HTTP helpers ────────────────────────────────────────────────────────

interface AdminCtx {
  baseUrl: string;
  jwt: string;
}

/**
 * SvelteKit catch-all in OWUI returns 200 OK with `<html>...` for unmatched
 * API paths. JSON.parse on that body throws an opaque SyntaxError that hides
 * the real cause — surface it as a readable error instead.
 */
function assertJsonText(label: string, text: string): void {
  if (text.trimStart().startsWith('<')) {
    throw new Error(
      `OpenWebUI ${label} returned HTML — admin route not registered on this OWUI build`,
    );
  }
}

async function adminGet<T>(ctx: AdminCtx, path: string): Promise<T> {
  const res = await fetch(`${ctx.baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${ctx.jwt}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`OpenWebUI GET ${path} failed: HTTP ${res.status}`);
  const text = await res.text();
  assertJsonText(`GET ${path}`, text);
  return JSON.parse(text) as T;
}

async function adminPost<T = unknown>(
  ctx: AdminCtx,
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`${ctx.baseUrl}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ctx.jwt}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  if (!res.ok) {
    const respText = await res.text().catch(() => '');
    throw new Error(`OpenWebUI POST ${path} failed: HTTP ${res.status} ${respText.slice(0, 200)}`);
  }
  const text = await res.text();
  // Some endpoints (toggle) return `true`/`false` literals; both parse fine.
  assertJsonText(`POST ${path}`, text);
  return JSON.parse(text) as T;
}

// ── Function lifecycle ─────────────────────────────────────────────────

async function listFunctions(ctx: AdminCtx): Promise<OpenwebuiFunctionRecord[]> {
  const data = await adminGet<unknown>(ctx, '/api/v1/functions/');
  return Array.isArray(data) ? (data as OpenwebuiFunctionRecord[]) : [];
}

async function createFunction(ctx: AdminCtx, form: OpenwebuiFunctionForm): Promise<void> {
  await adminPost(ctx, '/api/v1/functions/create', form as unknown as Record<string, unknown>);
}

async function updateFunction(
  ctx: AdminCtx,
  id: string,
  form: OpenwebuiFunctionForm,
): Promise<void> {
  await adminPost(
    ctx,
    `/api/v1/functions/id/${encodeURIComponent(id)}/update`,
    form as unknown as Record<string, unknown>,
  );
}

async function setValves(
  ctx: AdminCtx,
  id: string,
  valves: Record<string, unknown>,
): Promise<void> {
  await adminPost(ctx, `/api/v1/functions/id/${encodeURIComponent(id)}/valves/update`, valves);
}

async function toggleActive(ctx: AdminCtx, id: string): Promise<void> {
  await adminPost(ctx, `/api/v1/functions/id/${encodeURIComponent(id)}/toggle`, {});
}

async function toggleGlobal(ctx: AdminCtx, id: string): Promise<void> {
  await adminPost(ctx, `/api/v1/functions/id/${encodeURIComponent(id)}/toggle/global`, {});
}

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Push the Synap Filter Functions into Open WebUI.
 *
 * Auth pattern matches `pushSynapSkillsToOpenwebuiPrompts`: we forge an
 * admin JWT via `getAdminJwt()` (HS256 with WEBUI_SECRET_KEY) — the same
 * local-only path used everywhere else in `@eve/dna`. The eve agent's
 * `hubApiKey` is plumbed into each Function's valves so the running
 * container can call the Hub Protocol with a bearer that already exists.
 *
 * Idempotent: re-running compares content + name + valves and only POSTs
 * the deltas. Toggle endpoints flip state, so we only call them when the
 * current state diverges from the desired one.
 *
 * @throws if the admin JWT cannot be forged or the Hub API key is missing.
 *         Per-Function failures are non-fatal and reported via `skipped[]`.
 */
export async function pushSynapFunctionsToOpenwebui(
  cwd: string,
  _hubBaseUrl: string,
  _secrets: EveSecrets,
): Promise<FunctionsSyncResult> {
  // Hub bearer for the running Filter Functions to authenticate Synap calls.
  // We use the eve agent identity for both — same pattern as the prompts /
  // tool-server flows. The `hubBaseUrl` arg is intentionally unused: the
  // valves embed the container-network URL (`SYNAP_BACKEND_INTERNAL_URL`)
  // so OWUI's container resolves Synap via Docker DNS, not the public host.
  const apiKey = await readAgentKeyOrLegacy('eve', cwd);
  if (!apiKey) {
    throw new Error('No Hub API key — secrets.agents.eve.hubApiKey is unset');
  }

  const jwt = await getAdminJwt();
  if (!jwt) {
    throw new Error('OpenWebUI admin JWT unavailable — container down or no admin user');
  }

  const ctx: AdminCtx = { baseUrl: resolveOpenwebuiAdminUrl(), jwt };

  const existing = await listFunctions(ctx);
  const existingById = new Map<string, OpenwebuiFunctionRecord>();
  for (const fn of existing) existingById.set(fn.id, fn);

  const valves = {
    SYNAP_API_URL: SYNAP_BACKEND_INTERNAL_URL,
    SYNAP_API_KEY: apiKey,
  };

  const synced: FunctionsSyncResult['synced'] = [];
  const skipped: FunctionsSyncResult['skipped'] = [];

  for (const def of FUNCTION_DEFINITIONS) {
    const content = readFunctionSource(def.file);
    if (!content) {
      skipped.push({ id: def.id, reason: `source file not found: assets/functions/${def.file}` });
      continue;
    }

    const desired: OpenwebuiFunctionForm = {
      id: def.id,
      name: def.name,
      content,
      meta: { description: def.description },
    };

    try {
      const prior = existingById.get(def.id);
      let action: 'created' | 'updated' | 'unchanged';

      if (!prior) {
        await createFunction(ctx, desired);
        action = 'created';
      } else if (prior.content !== content || prior.name !== def.name) {
        await updateFunction(ctx, def.id, desired);
        action = 'updated';
      } else {
        action = 'unchanged';
      }

      // Always reconcile valves — secrets rotation needs to land here too.
      await setValves(ctx, def.id, valves);

      // Make sure the filter is active and applies globally. Toggles flip
      // state; only call when current state ≠ desired state.
      if (!prior || prior.is_active !== true) await toggleActive(ctx, def.id);
      if (!prior || prior.is_global !== true) await toggleGlobal(ctx, def.id);

      synced.push({
        id: def.id,
        name: def.name,
        action,
        enabled: true,
        global: true,
      });
    } catch (err) {
      skipped.push({
        id: def.id,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { synced, skipped };
}
