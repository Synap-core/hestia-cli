/**
 * @eve/dna — Synap → OpenWebUI Knowledge collection sync.
 *
 * Mirrors entries from a Synap knowledge namespace into a single OpenWebUI
 * "Workspace > Knowledge" collection so they appear in the UI alongside any
 * user-uploaded sources. Each Synap entry becomes one markdown file inside
 * the collection (`<slug-or-key>.md`).
 *
 * This complements `synap_knowledge_sync.py` (the inference-time filter
 * pipeline that injects relevant entries as a system message per turn) by
 * exposing the SAME data as a browseable, attachable Knowledge collection
 * — same source of truth, two surfaces. It does NOT duplicate the runtime
 * injection: pipelines stay the canonical recall path; this helper just
 * makes the catalogue visible.
 *
 * Idempotent: filenames are stable on Synap key, file bodies carry the
 * source SHA-256 in the trailing frontmatter so re-runs detect content
 * drift and replace only the changed files.
 *
 * Auth model:
 *   - Synap side: reuses the eve agent's `hubApiKey` (per-agent, falls
 *     back to legacy `synap.apiKey`).
 *   - OpenWebUI side: forges an admin JWT via `getAdminJwt()` (same
 *     pattern as `wire-ai.ts` and `registerOpenwebuiAdminApi`).
 *
 * NOT wired into `lifecycle/index.ts` yet — Wave 2 will call this from
 * the reconcile cascade.
 */
import { createHash } from 'node:crypto';
import { getAdminJwt, resolveOpenwebuiAdminUrl } from './openwebui-admin.js';
import {
  readAgentKeyOrLegacySync,
  type EveSecrets,
} from './secrets-contract.js';

// ── Public types ─────────────────────────────────────────────────────────

export interface KnowledgeSyncOptions {
  /** Synap namespace to mirror. Default: 'openwebui'. */
  namespace?: string;
  /** OWUI knowledge collection name. Default: 'Synap Knowledge ({namespace})'. */
  collectionName?: string;
  /** OWUI collection description. */
  collectionDescription?: string;
  /** Max entries to sync. Default: 500. */
  maxEntries?: number;
}

export interface KnowledgeSyncResult {
  collectionId: string;
  /** entries newly uploaded */
  added: number;
  /** entries whose content changed and were re-uploaded */
  updated: number;
  /** entries no longer in Synap that were removed from OWUI */
  removed: number;
  skipped: Array<{ key: string; reason: string }>;
}

// ── Internal types — narrow shapes of the API responses we touch ─────────

interface SynapKnowledgeEntry {
  key: string;
  value: string;
  namespace?: string | null;
  status?: string | null;
  slug?: string | null;
  author?: string | null;
}

interface OpenwebuiKnowledgeFile {
  id: string;
  /** Top-level filename written by OpenWebUI's files router. */
  filename?: string;
  /** Some OWUI versions only carry the human-readable name in `meta.name`. */
  meta?: { name?: string };
}

interface OpenwebuiKnowledgeCollection {
  id: string;
  name: string;
  description?: string;
  files?: OpenwebuiKnowledgeFile[];
}

// ── Constants ────────────────────────────────────────────────────────────

const DEFAULT_NAMESPACE = 'openwebui';
const DEFAULT_MAX_ENTRIES = 500;
/** Cap one-pass paging at 100 (matches Hub Protocol's default-friendly bucket). */
const SYNAP_PAGE_SIZE = 100;
const FILE_EXTENSION = '.md';
const SOURCE_HASH_MARKER = 'source-sha256:';

// ── Filename / hash helpers ──────────────────────────────────────────────

/**
 * Build a safe, deterministic filename for a Synap entry. Prefer `slug`
 * (already URL-safe by Synap's contract) and fall back to a sanitised
 * `key`. Always ends in `.md` so OWUI's text ingestion picks the right
 * loader.
 */
function filenameFor(entry: SynapKnowledgeEntry): string {
  const raw = (entry.slug && entry.slug.trim()) || entry.key;
  const safe = raw
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
  return `${safe || 'entry'}${FILE_EXTENSION}`;
}

/** SHA-256 hex of the rendered file body (used for drift detection). */
function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Render a Synap entry as a markdown file body. The trailing frontmatter
 * carries the source hash so a follow-up sync can detect content changes
 * by reading the existing file back.
 */
function renderFileBody(entry: SynapKnowledgeEntry, namespace: string): string {
  const lines = [
    `# ${entry.key}`,
    '',
    entry.value ?? '',
    '',
    '---',
    'source: synap',
    `namespace: ${namespace}`,
  ];
  if (entry.status) lines.push(`status: ${entry.status}`);
  if (entry.author) lines.push(`author: ${entry.author}`);
  return lines.join('\n');
}

/**
 * Build a {filename → entry} map enforcing the configured cap. When two
 * Synap entries collide on filename (e.g. same slug under different keys)
 * the FIRST entry wins — the loser is reported as `skipped` so callers
 * can fix the upstream conflict.
 */
function indexEntries(
  entries: SynapKnowledgeEntry[],
  maxEntries: number,
): { byFilename: Map<string, SynapKnowledgeEntry>; skipped: Array<{ key: string; reason: string }> } {
  const byFilename = new Map<string, SynapKnowledgeEntry>();
  const skipped: Array<{ key: string; reason: string }> = [];
  for (const entry of entries) {
    if (byFilename.size >= maxEntries) {
      skipped.push({ key: entry.key, reason: 'maxEntries reached' });
      continue;
    }
    const filename = filenameFor(entry);
    if (byFilename.has(filename)) {
      skipped.push({ key: entry.key, reason: `filename collision with another entry: ${filename}` });
      continue;
    }
    byFilename.set(filename, entry);
  }
  return { byFilename, skipped };
}

// ── Synap fetch ──────────────────────────────────────────────────────────

/**
 * Page through `GET /knowledge?namespace=...` until either the namespace
 * is exhausted or we hit `maxEntries`. The Hub Protocol returns a flat
 * array; we stop when a page returns fewer than `SYNAP_PAGE_SIZE` items.
 */
async function fetchSynapKnowledge(
  hubBaseUrl: string,
  hubApiKey: string,
  namespace: string,
  maxEntries: number,
): Promise<SynapKnowledgeEntry[]> {
  const out: SynapKnowledgeEntry[] = [];
  let offset = 0;

  while (out.length < maxEntries) {
    const limit = Math.min(SYNAP_PAGE_SIZE, maxEntries - out.length);
    const url = new URL(`${hubBaseUrl.replace(/\/$/, '')}/knowledge`);
    url.searchParams.set('namespace', namespace);
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('offset', String(offset));

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${hubApiKey}`,
        'Content-Type': 'application/json',
      },
    });
    if (!res.ok) {
      throw new Error(
        `Synap knowledge fetch failed: HTTP ${res.status} ${res.statusText}`,
      );
    }
    const data = (await res.json()) as unknown;
    if (!Array.isArray(data)) {
      throw new Error('Synap knowledge fetch returned non-array payload');
    }
    const page = data as SynapKnowledgeEntry[];
    out.push(...page);
    if (page.length < limit) break;
    offset += page.length;
  }

  return out.slice(0, maxEntries);
}

// ── OpenWebUI helpers ────────────────────────────────────────────────────

interface OwuiContext {
  baseUrl: string;
  jwt: string;
}

/**
 * OWUI's SvelteKit catch-all serves `index.html` (200 OK, `<html>...`) for
 * any unmatched API path — most often when the admin route hasn't loaded
 * yet or the build is missing the endpoint. Calling `.json()` on that body
 * throws an opaque `SyntaxError` and the operator can't tell SPA-shadow
 * apart from a real 5xx. Sniff the body and surface a readable error.
 */
function assertJsonText(path: string, text: string): void {
  if (text.trimStart().startsWith('<')) {
    throw new Error(
      `OpenWebUI ${path} returned HTML — admin route not registered on this OWUI build (SPA shell shadowing the API)`,
    );
  }
}

async function owuiGetJson<T>(ctx: OwuiContext, path: string): Promise<T> {
  const res = await fetch(`${ctx.baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${ctx.jwt}`, 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`OpenWebUI GET ${path} failed: HTTP ${res.status}`);
  }
  const text = await res.text();
  assertJsonText(`GET ${path}`, text);
  return JSON.parse(text) as T;
}

async function owuiPostJson<T>(
  ctx: OwuiContext,
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`${ctx.baseUrl}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ctx.jwt}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`OpenWebUI POST ${path} failed: HTTP ${res.status}`);
  }
  const text = await res.text();
  assertJsonText(`POST ${path}`, text);
  return JSON.parse(text) as T;
}

/**
 * List existing Knowledge collections and pick the first one whose name
 * matches; create a fresh collection if none exists. Returns the
 * collection object as known to OWUI.
 */
async function ensureCollection(
  ctx: OwuiContext,
  name: string,
  description: string,
): Promise<OpenwebuiKnowledgeCollection> {
  const list = await owuiGetJson<OpenwebuiKnowledgeCollection[]>(ctx, '/api/v1/knowledge/');
  const existing = Array.isArray(list) ? list.find((c) => c.name === name) : undefined;
  if (existing) {
    // Re-fetch by id so we get the embedded files array (the list
    // endpoint omits files in some OWUI versions).
    return owuiGetJson<OpenwebuiKnowledgeCollection>(
      ctx,
      `/api/v1/knowledge/${existing.id}`,
    );
  }
  return owuiPostJson<OpenwebuiKnowledgeCollection>(ctx, '/api/v1/knowledge/create', {
    name,
    description,
  });
}

/** Extract the human filename used to attach a file inside a collection. */
function fileNameOf(file: OpenwebuiKnowledgeFile): string {
  return file.filename ?? file.meta?.name ?? '';
}

/**
 * Download the raw body of a previously uploaded file. Used to detect
 * content drift via the trailing `source-sha256:` marker.
 */
async function fetchFileContent(ctx: OwuiContext, fileId: string): Promise<string> {
  const res = await fetch(`${ctx.baseUrl}/api/v1/files/${fileId}/data/content`, {
    headers: { Authorization: `Bearer ${ctx.jwt}` },
  });
  if (!res.ok) {
    throw new Error(`OpenWebUI fetch file content failed: HTTP ${res.status}`);
  }
  return res.text();
}

/**
 * Best-effort source-hash extraction from a previously rendered body. We
 * compute the hash over the rendered body string itself (cheaper and
 * more reliable than parsing). Returns null on any failure so callers
 * fall back to a forced re-upload.
 */
async function getRemoteContentHash(
  ctx: OwuiContext,
  fileId: string,
): Promise<string | null> {
  try {
    const body = await fetchFileContent(ctx, fileId);
    return sha256Hex(body);
  } catch {
    return null;
  }
}

/**
 * Upload a rendered markdown body as a new OpenWebUI file. Returns the
 * file id assigned by OWUI.
 *
 * Endpoint: `POST /api/v1/files/` (multipart/form-data, field name
 * `file`). Content-Type for the part is `text/markdown` so OWUI's
 * ingestion picks the markdown loader.
 */
async function uploadFile(
  ctx: OwuiContext,
  filename: string,
  body: string,
): Promise<string> {
  const form = new FormData();
  form.append(
    'file',
    new Blob([body], { type: 'text/markdown' }),
    filename,
  );
  const res = await fetch(`${ctx.baseUrl}/api/v1/files/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ctx.jwt}` },
    body: form,
  });
  if (!res.ok) {
    throw new Error(`OpenWebUI file upload failed: HTTP ${res.status}`);
  }
  const text = await res.text();
  assertJsonText('POST /api/v1/files/', text);
  const data = JSON.parse(text) as { id?: string };
  if (!data.id) {
    throw new Error('OpenWebUI file upload returned no id');
  }
  return data.id;
}

/** Attach a previously uploaded file to a Knowledge collection. */
async function attachFile(
  ctx: OwuiContext,
  collectionId: string,
  fileId: string,
): Promise<void> {
  await owuiPostJson(ctx, `/api/v1/knowledge/${collectionId}/file/add`, {
    file_id: fileId,
  });
}

/** Detach a file from a Knowledge collection (does not delete the file). */
async function removeFile(
  ctx: OwuiContext,
  collectionId: string,
  fileId: string,
): Promise<void> {
  await owuiPostJson(ctx, `/api/v1/knowledge/${collectionId}/file/remove`, {
    file_id: fileId,
  });
}

/** Hard-delete a file. Best-effort — failure here is logged via skipped. */
async function deleteFile(ctx: OwuiContext, fileId: string): Promise<void> {
  const res = await fetch(`${ctx.baseUrl}/api/v1/files/${fileId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${ctx.jwt}` },
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`OpenWebUI file delete failed: HTTP ${res.status}`);
  }
}

// ── Public entry point ───────────────────────────────────────────────────

/**
 * Pull Synap knowledge in the chosen namespace and reconcile an OpenWebUI
 * knowledge collection.
 *
 * Each Synap entry becomes one text file (`<slug-or-key>.md`) inside the
 * collection. Idempotent on key: re-running the sync only re-uploads
 * entries whose body has changed.
 *
 * Throws on auth or network failures. Per-entry errors land in `skipped`
 * so a single bad entry doesn't tank the whole reconcile.
 */
export async function syncSynapKnowledgeToOpenwebui(
  cwd: string,
  hubBaseUrl: string,
  secrets: EveSecrets,
  opts: KnowledgeSyncOptions = {},
): Promise<KnowledgeSyncResult> {
  void cwd; // kept on the signature for future use (file logging, lock files)

  const namespace = opts.namespace?.trim() || DEFAULT_NAMESPACE;
  const collectionName = opts.collectionName?.trim() || `Synap Knowledge (${namespace})`;
  const collectionDescription =
    opts.collectionDescription?.trim() ||
    `Mirrored from Synap pod (namespace: ${namespace}). Managed by Eve.`;
  const maxEntries = opts.maxEntries ?? DEFAULT_MAX_ENTRIES;

  const hubApiKey = readAgentKeyOrLegacySync('eve', secrets);
  if (!hubApiKey) {
    throw new Error('No Synap Hub API key available (looked for agents.eve.hubApiKey / synap.apiKey)');
  }

  const jwt = await getAdminJwt();
  if (!jwt) {
    throw new Error('Could not forge OpenWebUI admin JWT (is the container up and an admin signed up?)');
  }
  const ctx: OwuiContext = { baseUrl: resolveOpenwebuiAdminUrl(), jwt };

  // 1) Pull the source of truth from Synap.
  const synapEntries = await fetchSynapKnowledge(
    hubBaseUrl,
    hubApiKey,
    namespace,
    maxEntries,
  );

  if (synapEntries.length === 0) {
    // Nothing to sync — skip all OWUI API calls and return a clean zero result.
    return { collectionId: '', added: 0, updated: 0, removed: 0, skipped: [] };
  }

  const { byFilename: desired, skipped } = indexEntries(synapEntries, maxEntries);

  // 2) Resolve the collection (create if missing) and snapshot its files.
  const collection = await ensureCollection(ctx, collectionName, collectionDescription);
  const remoteByFilename = new Map<string, OpenwebuiKnowledgeFile>();
  for (const file of collection.files ?? []) {
    const name = fileNameOf(file);
    if (name) remoteByFilename.set(name, file);
  }

  let added = 0;
  let updated = 0;
  let removed = 0;

  // 3) Add + update.
  for (const [filename, entry] of desired.entries()) {
    const body = renderFileBody(entry, namespace);
    const desiredHash = sha256Hex(body);
    const remote = remoteByFilename.get(filename);

    try {
      if (!remote) {
        const fileId = await uploadFile(ctx, filename, body);
        await attachFile(ctx, collection.id, fileId);
        added++;
        continue;
      }
      const remoteHash = await getRemoteContentHash(ctx, remote.id);
      if (remoteHash === desiredHash) {
        // Already in sync — leave the existing file in place.
        continue;
      }
      // Drift: detach + delete the old file, then upload + attach the new one.
      await removeFile(ctx, collection.id, remote.id);
      await deleteFile(ctx, remote.id);
      const fileId = await uploadFile(ctx, filename, body);
      await attachFile(ctx, collection.id, fileId);
      updated++;
    } catch (err) {
      skipped.push({
        key: entry.key,
        reason: err instanceof Error ? err.message : 'unknown error',
      });
    }
  }

  // 4) Remove orphaned remote files (Synap deleted / namespace changed).
  for (const [filename, remote] of remoteByFilename.entries()) {
    if (desired.has(filename)) continue;
    try {
      await removeFile(ctx, collection.id, remote.id);
      await deleteFile(ctx, remote.id);
      removed++;
    } catch (err) {
      skipped.push({
        key: filename,
        reason: err instanceof Error ? err.message : 'unknown error',
      });
    }
  }

  return {
    collectionId: collection.id,
    added,
    updated,
    removed,
    skipped,
  };
}
