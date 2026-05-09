import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EveSecrets } from '../src/secrets-contract.js';

// Mocks: keep the test about the sync logic — no disk reads of secrets,
// no docker exec for the OWUI admin JWT.
vi.mock('../src/secrets-contract.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/secrets-contract.js')>();
  return {
    ...original,
    readAgentKeyOrLegacy: vi.fn(),
  };
});

vi.mock('../src/openwebui-admin.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/openwebui-admin.js')>();
  return {
    ...original,
    getAdminJwt: vi.fn(),
  };
});

import { pushSynapFunctionsToOpenwebui } from '../src/openwebui-functions-sync.js';
import { readAgentKeyOrLegacy } from '../src/secrets-contract.js';
import { getAdminJwt } from '../src/openwebui-admin.js';

const HUB_BASE_URL = 'https://pod.example.com/api/hub';
const SECRETS: EveSecrets = {
  version: '1',
  updatedAt: '2026-05-10T00:00:00.000Z',
};

interface FetchCall {
  url: string;
  method: string;
  body: unknown;
}

function makeFetchMock(handler: (call: FetchCall) => Response): {
  fetchMock: ReturnType<typeof vi.fn>;
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? 'GET';
    let body: unknown = undefined;
    if (init?.body) {
      try { body = JSON.parse(String(init.body)); } catch { body = init.body; }
    }
    const call: FetchCall = { url, method, body };
    calls.push(call);
    return handler(call);
  });
  return { fetchMock, calls };
}

beforeEach(() => {
  vi.mocked(readAgentKeyOrLegacy).mockResolvedValue('hub-eve-key');
  vi.mocked(getAdminJwt).mockResolvedValue('owui-admin-jwt');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('pushSynapFunctionsToOpenwebui', () => {
  it('creates both filter functions on a fresh OpenWebUI', async () => {
    const { fetchMock, calls } = makeFetchMock((call) => {
      if (call.url.endsWith('/api/v1/functions/') && call.method === 'GET') {
        // Fresh OWUI: no functions yet.
        return new Response('[]', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (call.url.endsWith('/api/v1/functions/create') && call.method === 'POST') {
        return new Response('{}', { status: 200 });
      }
      if (call.url.includes('/api/v1/functions/id/') && call.method === 'POST') {
        // valves/update + toggle + toggle/global all 200 with empty bodies
        return new Response('{}', { status: 200 });
      }
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await pushSynapFunctionsToOpenwebui('/tmp/cwd', HUB_BASE_URL, SECRETS);

    expect(result.synced.map((s) => s.id)).toEqual([
      'synap_memory_filter',
      'synap_channel_sync',
    ]);
    expect(result.synced.every((s) => s.action === 'created')).toBe(true);
    expect(result.synced.every((s) => s.enabled && s.global)).toBe(true);
    expect(result.skipped).toEqual([]);

    // Two creates posted with the python source as `content`.
    const creates = calls.filter((c) => c.url.endsWith('/api/v1/functions/create'));
    expect(creates).toHaveLength(2);

    const memCreate = creates.find((c) => (c.body as { id?: string }).id === 'synap_memory_filter');
    expect(memCreate).toBeDefined();
    const memBody = memCreate!.body as { id: string; name: string; content: string };
    expect(memBody.name).toBe('Synap Memory Injection');
    // Sanity: the content is the actual python source — must contain the
    // `class Filter:` declaration that OWUI v0.9.4's loader looks for.
    expect(memBody.content).toContain('class Filter:');

    // Valves were set with the eve agent key as bearer.
    const valveCalls = calls.filter((c) => c.url.includes('/valves/update'));
    expect(valveCalls).toHaveLength(2);
    expect(valveCalls[0]?.body).toMatchObject({ SYNAP_API_KEY: 'hub-eve-key' });

    // Toggles called once each per function (active + global).
    const toggleActive = calls.filter((c) => c.url.match(/\/toggle$/));
    const toggleGlobal = calls.filter((c) => c.url.match(/\/toggle\/global$/));
    expect(toggleActive).toHaveLength(2);
    expect(toggleGlobal).toHaveLength(2);
  });

  it('updates an existing filter when the python source changed', async () => {
    const existingFunctions = [
      {
        id: 'synap_memory_filter',
        name: 'Synap Memory Injection',
        type: 'filter',
        content: '# OUTDATED memory filter source',
        is_active: true,
        is_global: true,
      },
      {
        id: 'synap_channel_sync',
        name: 'Synap Channel Sync',
        type: 'filter',
        // Pretend channel_sync was already current — listFunctions sees the
        // current desired source verbatim, so no update is needed for it.
        // The test fixture below stubs it to whatever the loader produces.
        content: '__current_source__',
        is_active: true,
        is_global: true,
      },
    ];

    // Capture the channel_sync's current desired content from the asset
    // file so the diff considers it unchanged.
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const here = dirname(fileURLToPath(import.meta.url));
    const channelSyncSource = readFileSync(
      join(here, '..', 'assets', 'functions', 'synap_channel_sync.py'),
      'utf-8',
    );
    existingFunctions[1].content = channelSyncSource;

    const { fetchMock, calls } = makeFetchMock((call) => {
      if (call.url.endsWith('/api/v1/functions/') && call.method === 'GET') {
        return new Response(JSON.stringify(existingFunctions), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (call.url.endsWith('/api/v1/functions/create')) {
        return new Response('{}', { status: 200 });
      }
      if (call.url.includes('/api/v1/functions/id/') && call.method === 'POST') {
        return new Response('{}', { status: 200 });
      }
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await pushSynapFunctionsToOpenwebui('/tmp/cwd', HUB_BASE_URL, SECRETS);

    const memSync = result.synced.find((s) => s.id === 'synap_memory_filter');
    const channelSync = result.synced.find((s) => s.id === 'synap_channel_sync');
    expect(memSync?.action).toBe('updated');
    expect(channelSync?.action).toBe('unchanged');

    // Memory filter updated via id-keyed endpoint.
    const updates = calls.filter(
      (c) => c.url.includes('/api/v1/functions/id/synap_memory_filter/update'),
    );
    expect(updates).toHaveLength(1);

    // No CREATE calls — both already exist.
    expect(calls.filter((c) => c.url.endsWith('/api/v1/functions/create'))).toHaveLength(0);

    // Toggles NOT called for either — both were already active + global.
    expect(calls.filter((c) => c.url.match(/\/toggle$/))).toHaveLength(0);
    expect(calls.filter((c) => c.url.match(/\/toggle\/global$/))).toHaveLength(0);
  });

  it('flips toggles when an existing function is disabled or non-global', async () => {
    const existingFunctions = [
      {
        id: 'synap_memory_filter',
        name: 'Synap Memory Injection',
        type: 'filter',
        content: 'placeholder',
        is_active: false, // ← needs flipping
        is_global: true,
      },
      {
        id: 'synap_channel_sync',
        name: 'Synap Channel Sync',
        type: 'filter',
        content: 'placeholder',
        is_active: true,
        is_global: false, // ← needs flipping
      },
    ];

    const { fetchMock, calls } = makeFetchMock((call) => {
      if (call.url.endsWith('/api/v1/functions/') && call.method === 'GET') {
        return new Response(JSON.stringify(existingFunctions), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (call.url.includes('/api/v1/functions/id/') && call.method === 'POST') {
        return new Response('{}', { status: 200 });
      }
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await pushSynapFunctionsToOpenwebui('/tmp/cwd', HUB_BASE_URL, SECRETS);

    const memToggleActive = calls.find(
      (c) => c.url.includes('/synap_memory_filter/toggle') && !c.url.includes('/global'),
    );
    const memToggleGlobal = calls.find((c) => c.url.includes('/synap_memory_filter/toggle/global'));
    const channelToggleActive = calls.find(
      (c) => c.url.includes('/synap_channel_sync/toggle') && !c.url.includes('/global'),
    );
    const channelToggleGlobal = calls.find(
      (c) => c.url.includes('/synap_channel_sync/toggle/global'),
    );

    // memory_filter: only active toggle (it's already global)
    expect(memToggleActive).toBeDefined();
    expect(memToggleGlobal).toBeUndefined();

    // channel_sync: only global toggle (it's already active)
    expect(channelToggleActive).toBeUndefined();
    expect(channelToggleGlobal).toBeDefined();
  });

  it('throws when OpenWebUI admin JWT cannot be forged', async () => {
    vi.mocked(getAdminJwt).mockResolvedValue(null);

    await expect(
      pushSynapFunctionsToOpenwebui('/tmp/cwd', HUB_BASE_URL, SECRETS),
    ).rejects.toThrow(/admin JWT unavailable/);
  });

  it('throws when no eve hub api key is available', async () => {
    vi.mocked(readAgentKeyOrLegacy).mockResolvedValue(null);

    await expect(
      pushSynapFunctionsToOpenwebui('/tmp/cwd', HUB_BASE_URL, SECRETS),
    ).rejects.toThrow(/Hub API key/);
  });
});
