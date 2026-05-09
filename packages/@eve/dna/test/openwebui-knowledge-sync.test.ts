import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EveSecrets } from '../src/secrets-contract.js';

vi.mock('../src/openwebui-admin.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/openwebui-admin.js')>();
  return {
    ...actual,
    getAdminJwt: vi.fn(async () => 'test-jwt'),
  };
});

import { syncSynapKnowledgeToOpenwebui } from '../src/openwebui-knowledge-sync.js';

// ── Helpers ───────────────────────────────────────────────────────────────

const HUB_BASE = 'http://synap.local/api/hub';
const NAMESPACE = 'openwebui';

function makeSecrets(hubApiKey = 'eve-key'): EveSecrets {
  return {
    version: '1',
    updatedAt: new Date().toISOString(),
    agents: {
      eve: {
        hubApiKey,
        agentUserId: 'eve-user',
        workspaceId: 'eve-ws',
      },
    },
  };
}

interface FakeKnowledgeFile {
  id: string;
  filename: string;
  body: string;
}

interface FakeKnowledgeCollection {
  id: string;
  name: string;
  description?: string;
  fileIds: string[];
}

/**
 * Stand-in OWUI + Synap server. Each test sets up the desired Synap
 * entries and the (optional) initial OWUI collection, then asserts on
 * the post-state. fetch is mocked module-wide so the helper runs the
 * full code path.
 */
class FakeBackend {
  synapEntries: Array<{ key: string; value: string; namespace?: string; slug?: string }> = [];
  hubAuthError = false;
  collections: FakeKnowledgeCollection[] = [];
  files = new Map<string, FakeKnowledgeFile>();
  nextFileId = 1;

  addSynap(entries: Array<{ key: string; value: string; slug?: string }>): void {
    for (const e of entries) {
      this.synapEntries.push({ ...e, namespace: NAMESPACE });
    }
  }

  /** Seed an OWUI collection with the given entries' rendered files. */
  seedCollection(name: string, entries: Array<{ filename: string; body: string }>): FakeKnowledgeCollection {
    const fileIds: string[] = [];
    for (const e of entries) {
      const id = `f${this.nextFileId++}`;
      this.files.set(id, { id, filename: e.filename, body: e.body });
      fileIds.push(id);
    }
    const col: FakeKnowledgeCollection = {
      id: `c${this.collections.length + 1}`,
      name,
      fileIds,
    };
    this.collections.push(col);
    return col;
  }

  handle(input: RequestInfo | URL, init?: RequestInit): Response {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? 'GET').toUpperCase();

    // ── Synap Hub ────────────────────────────────────────────────────────
    if (url.startsWith(HUB_BASE)) {
      if (this.hubAuthError) {
        return new Response('unauthorized', { status: 401 });
      }
      if (url.includes('/knowledge') && method === 'GET') {
        const u = new URL(url);
        const limit = parseInt(u.searchParams.get('limit') ?? '50', 10);
        const offset = parseInt(u.searchParams.get('offset') ?? '0', 10);
        const ns = u.searchParams.get('namespace');
        const all = this.synapEntries.filter((e) => !ns || e.namespace === ns);
        return new Response(JSON.stringify(all.slice(offset, offset + limit)), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
    }

    // ── OpenWebUI admin ──────────────────────────────────────────────────
    // List collections
    if (url.endsWith('/api/v1/knowledge/') && method === 'GET') {
      return new Response(JSON.stringify(this.collections.map((c) => ({
        id: c.id, name: c.name, description: c.description,
      }))), { status: 200, headers: { 'content-type': 'application/json' } });
    }

    // Create collection
    if (url.endsWith('/api/v1/knowledge/create') && method === 'POST') {
      const body = JSON.parse(String(init?.body ?? '{}')) as { name: string; description?: string };
      const col: FakeKnowledgeCollection = {
        id: `c${this.collections.length + 1}`,
        name: body.name,
        description: body.description,
        fileIds: [],
      };
      this.collections.push(col);
      return new Response(JSON.stringify({ id: col.id, name: col.name, description: col.description, files: [] }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    }

    // Get collection by id (returns embedded files)
    const getCol = url.match(/\/api\/v1\/knowledge\/(c\d+)$/);
    if (getCol && method === 'GET') {
      const col = this.collections.find((c) => c.id === getCol[1]);
      if (!col) return new Response('not found', { status: 404 });
      const files = col.fileIds.map((id) => {
        const f = this.files.get(id);
        return f ? { id: f.id, filename: f.filename, meta: { name: f.filename } } : null;
      }).filter((x): x is NonNullable<typeof x> => x !== null);
      return new Response(JSON.stringify({ id: col.id, name: col.name, description: col.description, files }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    }

    // Add file to collection
    const addFile = url.match(/\/api\/v1\/knowledge\/(c\d+)\/file\/add$/);
    if (addFile && method === 'POST') {
      const body = JSON.parse(String(init?.body ?? '{}')) as { file_id: string };
      const col = this.collections.find((c) => c.id === addFile[1]);
      if (!col) return new Response('not found', { status: 404 });
      if (!col.fileIds.includes(body.file_id)) col.fileIds.push(body.file_id);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    }

    // Remove file from collection
    const rmFile = url.match(/\/api\/v1\/knowledge\/(c\d+)\/file\/remove$/);
    if (rmFile && method === 'POST') {
      const body = JSON.parse(String(init?.body ?? '{}')) as { file_id: string };
      const col = this.collections.find((c) => c.id === rmFile[1]);
      if (!col) return new Response('not found', { status: 404 });
      col.fileIds = col.fileIds.filter((id) => id !== body.file_id);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    }

    // Upload file (multipart)
    if (url.endsWith('/api/v1/files/') && method === 'POST') {
      const id = `f${this.nextFileId++}`;
      const form = init?.body;
      // FormData arrives as the body; for our purposes we just stash a
      // marker — actual content extraction would require parsing. Tests
      // assert via the in-memory mirror updated below.
      const filename = pendingUploadFilename;
      const body = pendingUploadBody;
      this.files.set(id, { id, filename, body });
      // Reset pending markers
      pendingUploadFilename = '';
      pendingUploadBody = '';
      void form;
      return new Response(JSON.stringify({ id, filename, meta: { name: filename } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    }

    // Get file content
    const getContent = url.match(/\/api\/v1\/files\/(f\d+)\/data\/content$/);
    if (getContent && method === 'GET') {
      const f = this.files.get(getContent[1]);
      if (!f) return new Response('not found', { status: 404 });
      return new Response(f.body, { status: 200, headers: { 'content-type': 'text/plain' } });
    }

    // Delete file
    const delFile = url.match(/\/api\/v1\/files\/(f\d+)$/);
    if (delFile && method === 'DELETE') {
      this.files.delete(delFile[1]);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    }

    return new Response(`unhandled ${method} ${url}`, { status: 599 });
  }
}

// FormData inspection in node fetch mocks is awkward — instead of parsing
// the multipart body, the helper sets these globals before calling
// `uploadFile` indirectly. The fake backend reads them when it sees the
// upload POST. This is the only place test code reaches into the
// implementation, and it's a faithful proxy for "what would the file
// contents be on disk".
let pendingUploadFilename = '';
let pendingUploadBody = '';

function withUpload<T>(filename: string, body: string, fn: () => Promise<T>): Promise<T> {
  pendingUploadFilename = filename;
  pendingUploadBody = body;
  return fn();
}

void withUpload;

/**
 * Hook to capture the pending upload filename + body BEFORE the helper
 * calls fetch, by intercepting the FormData passed to fetch. This keeps
 * the implementation honest (no side-channel) but lets us assert on
 * what was uploaded.
 */
function installFetchMock(backend: FakeBackend): void {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    // Snoop multipart uploads: pull filename + text content out of FormData
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.endsWith('/api/v1/files/') && (init?.method ?? 'GET').toUpperCase() === 'POST') {
      const fd = init?.body as FormData | undefined;
      if (fd && typeof fd.get === 'function') {
        const part = fd.get('file');
        if (part instanceof Blob) {
          pendingUploadFilename = (part as File).name ?? '';
          pendingUploadBody = await part.text();
        }
      }
    }
    return backend.handle(input, init);
  });
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('syncSynapKnowledgeToOpenwebui', () => {
  let backend: FakeBackend;

  beforeEach(() => {
    backend = new FakeBackend();
    installFetchMock(backend);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    pendingUploadFilename = '';
    pendingUploadBody = '';
  });

  it('creates the collection and uploads N files when OWUI is empty', async () => {
    backend.addSynap([
      { key: 'reply-style', value: 'Always reply in French.', slug: 'reply-style' },
      { key: 'glossary/foo', value: 'Foo means bar.', slug: 'glossary-foo' },
    ]);

    const result = await syncSynapKnowledgeToOpenwebui(
      '/tmp/cwd', HUB_BASE, makeSecrets(),
    );

    expect(result.added).toBe(2);
    expect(result.updated).toBe(0);
    expect(result.removed).toBe(0);
    expect(result.skipped).toEqual([]);
    expect(backend.collections).toHaveLength(1);
    expect(backend.collections[0].fileIds).toHaveLength(2);
    // Files exist on the OWUI side with the expected filenames
    const filenames = backend.collections[0].fileIds.map((id) => backend.files.get(id)?.filename);
    expect(filenames.sort()).toEqual(['glossary-foo.md', 'reply-style.md']);
  });

  it('is a no-op when the collection already mirrors Synap exactly', async () => {
    // Pre-render the same body the helper would produce
    const body = [
      '# reply-style',
      '',
      'Always reply in French.',
      '',
      '---',
      'source: synap',
      `namespace: ${NAMESPACE}`,
    ].join('\n');
    const col = backend.seedCollection(`Synap Knowledge (${NAMESPACE})`, [
      { filename: 'reply-style.md', body },
    ]);
    backend.addSynap([{ key: 'reply-style', value: 'Always reply in French.', slug: 'reply-style' }]);

    const result = await syncSynapKnowledgeToOpenwebui(
      '/tmp/cwd', HUB_BASE, makeSecrets(),
    );

    expect(result.added).toBe(0);
    expect(result.updated).toBe(0);
    expect(result.removed).toBe(0);
    expect(result.collectionId).toBe(col.id);
    expect(col.fileIds).toHaveLength(1);
  });

  it('uploads only newly added entries', async () => {
    // Pre-existing: one file that matches one of the Synap entries
    const existingBody = [
      '# keep', '', 'keep me',
      '', '---', 'source: synap', `namespace: ${NAMESPACE}`,
    ].join('\n');
    backend.seedCollection(`Synap Knowledge (${NAMESPACE})`, [
      { filename: 'keep.md', body: existingBody },
    ]);
    backend.addSynap([
      { key: 'keep', value: 'keep me', slug: 'keep' },
      { key: 'new-1', value: 'one', slug: 'new-1' },
      { key: 'new-2', value: 'two', slug: 'new-2' },
    ]);

    const result = await syncSynapKnowledgeToOpenwebui(
      '/tmp/cwd', HUB_BASE, makeSecrets(),
    );

    expect(result.added).toBe(2);
    expect(result.updated).toBe(0);
    expect(result.removed).toBe(0);
  });

  it('removes files for entries no longer present in Synap', async () => {
    const body = (k: string, v: string) => [
      `# ${k}`, '', v, '', '---', 'source: synap', `namespace: ${NAMESPACE}`,
    ].join('\n');
    backend.seedCollection(`Synap Knowledge (${NAMESPACE})`, [
      { filename: 'keep.md', body: body('keep', 'still here') },
      { filename: 'gone.md', body: body('gone', 'was here') },
    ]);
    backend.addSynap([{ key: 'keep', value: 'still here', slug: 'keep' }]);

    const result = await syncSynapKnowledgeToOpenwebui(
      '/tmp/cwd', HUB_BASE, makeSecrets(),
    );

    expect(result.added).toBe(0);
    expect(result.updated).toBe(0);
    expect(result.removed).toBe(1);
    expect(backend.collections[0].fileIds).toHaveLength(1);
  });

  it('updates a file when the Synap entry content changed', async () => {
    const oldBody = [
      '# rule', '', 'old text', '', '---', 'source: synap', `namespace: ${NAMESPACE}`,
    ].join('\n');
    const col = backend.seedCollection(`Synap Knowledge (${NAMESPACE})`, [
      { filename: 'rule.md', body: oldBody },
    ]);
    const oldFileId = col.fileIds[0];
    backend.addSynap([{ key: 'rule', value: 'new text', slug: 'rule' }]);

    const result = await syncSynapKnowledgeToOpenwebui(
      '/tmp/cwd', HUB_BASE, makeSecrets(),
    );

    expect(result.added).toBe(0);
    expect(result.updated).toBe(1);
    expect(result.removed).toBe(0);
    // Old file id should be gone, new one attached
    expect(backend.files.has(oldFileId)).toBe(false);
    expect(col.fileIds).toHaveLength(1);
    const newBody = backend.files.get(col.fileIds[0])?.body ?? '';
    expect(newBody).toContain('new text');
  });

  it('throws when the Synap hub returns an auth error', async () => {
    backend.hubAuthError = true;
    backend.addSynap([{ key: 'k', value: 'v' }]);

    await expect(
      syncSynapKnowledgeToOpenwebui('/tmp/cwd', HUB_BASE, makeSecrets()),
    ).rejects.toThrow(/Synap knowledge fetch failed/);
  });
});
