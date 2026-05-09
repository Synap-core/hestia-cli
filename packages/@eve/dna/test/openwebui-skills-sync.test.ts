import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EveSecrets } from '../src/secrets-contract.js';

// We mock the secrets-contract reader (Hub auth path) and openwebui-admin
// JWT forger (OpenWebUI auth path) to keep the test purely about the sync
// logic — no disk, no docker, no SQLite.
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

import { pushSynapSkillsToOpenwebuiPrompts } from '../src/openwebui-skills-sync.js';
import { readAgentKeyOrLegacy } from '../src/secrets-contract.js';
import { getAdminJwt } from '../src/openwebui-admin.js';

const HUB_BASE_URL = 'https://pod.example.com/api/hub';
const SECRETS: EveSecrets = {
  version: '1',
  updatedAt: '2026-05-09T00:00:00.000Z',
};

const SKILL_PACKAGES = [
  {
    slug: 'synap',
    files: [{ path: 'SKILL.md', content: '# synap skill body' }],
  },
  {
    slug: 'synap-schema',
    files: [{ path: 'SKILL.md', content: '# synap-schema skill body' }],
  },
  {
    slug: 'synap-ui',
    files: [{ path: 'SKILL.md', content: '# synap-ui skill body' }],
  },
];

interface FetchCall {
  url: string;
  method: string;
  body: unknown;
}

/** Build a fetch mock that records every call and returns scripted responses. */
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

describe('pushSynapSkillsToOpenwebuiPrompts', () => {
  it('creates 3 prompts on a fresh OpenWebUI with no existing prompts', async () => {
    const { fetchMock, calls } = makeFetchMock((call) => {
      if (call.url.endsWith('/api/hub/skills/system')) {
        return new Response(JSON.stringify(SKILL_PACKAGES), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (call.url.endsWith('/api/v1/prompts/') && call.method === 'GET') {
        return new Response('[]', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (call.url.endsWith('/api/v1/prompts/create') && call.method === 'POST') {
        return new Response('{}', { status: 200 });
      }
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await pushSynapSkillsToOpenwebuiPrompts('/tmp/cwd', HUB_BASE_URL, SECRETS);

    expect(result.created).toBe(3);
    expect(result.updated).toBe(0);
    expect(result.skipped).toEqual([]);
    expect(result.synced.map(p => p.command)).toEqual(['synap', 'synap-schema', 'synap-ui']);

    const createCalls = calls.filter(c => c.url.endsWith('/api/v1/prompts/create'));
    expect(createCalls).toHaveLength(3);
    expect(createCalls[0]?.body).toMatchObject({
      command: 'synap',
      content: '# synap skill body',
    });
    // Title carries the synap:system tag so operators can spot Eve-managed entries.
    const firstBody = createCalls[0]?.body as { title?: string };
    expect(firstBody.title).toContain('synap:system');
  });

  it('no-ops when existing prompts already match SKILL.md content', async () => {
    const { fetchMock } = makeFetchMock((call) => {
      if (call.url.endsWith('/api/hub/skills/system')) {
        return new Response(JSON.stringify(SKILL_PACKAGES), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (call.url.endsWith('/api/v1/prompts/') && call.method === 'GET') {
        // Mirror back identical content + title so the diff sees no change.
        return new Response(JSON.stringify([
          {
            command: 'synap',
            title: 'Synap — Capture, Memory, Channels [synap:system]',
            content: '# synap skill body',
          },
          {
            command: 'synap-schema',
            title: 'Synap Schema — Profiles & Property Defs [synap:system]',
            content: '# synap-schema skill body',
          },
          {
            command: 'synap-ui',
            title: 'Synap UI — Views & Dashboards [synap:system]',
            content: '# synap-ui skill body',
          },
        ]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('unexpected', { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await pushSynapSkillsToOpenwebuiPrompts('/tmp/cwd', HUB_BASE_URL, SECRETS);

    expect(result.created).toBe(0);
    expect(result.updated).toBe(0);
    expect(result.skipped).toEqual([]);
    expect(result.synced).toHaveLength(3);
  });

  it('updates an existing prompt whose content drifted from SKILL.md', async () => {
    const { fetchMock, calls } = makeFetchMock((call) => {
      if (call.url.endsWith('/api/hub/skills/system')) {
        return new Response(JSON.stringify(SKILL_PACKAGES), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (call.url.endsWith('/api/v1/prompts/') && call.method === 'GET') {
        return new Response(JSON.stringify([
          // synap exists but with stale content → expect update.
          {
            command: 'synap',
            title: 'Synap — Capture, Memory, Channels [synap:system]',
            content: '# OUTDATED synap content',
          },
          {
            command: 'synap-schema',
            title: 'Synap Schema — Profiles & Property Defs [synap:system]',
            content: '# synap-schema skill body',
          },
          {
            command: 'synap-ui',
            title: 'Synap UI — Views & Dashboards [synap:system]',
            content: '# synap-ui skill body',
          },
        ]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (call.url.includes('/api/v1/prompts/command/synap/update') && call.method === 'POST') {
        return new Response('{}', { status: 200 });
      }
      return new Response('unexpected', { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await pushSynapSkillsToOpenwebuiPrompts('/tmp/cwd', HUB_BASE_URL, SECRETS);

    expect(result.created).toBe(0);
    expect(result.updated).toBe(1);
    expect(result.skipped).toEqual([]);

    const updateCalls = calls.filter(c => c.url.includes('/prompts/command/synap/update'));
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]?.body).toMatchObject({
      command: 'synap',
      content: '# synap skill body',
    });
  });

  it('throws when the Hub /skills/system fetch fails', async () => {
    const { fetchMock } = makeFetchMock((call) => {
      if (call.url.endsWith('/api/hub/skills/system')) {
        return new Response('upstream down', { status: 503 });
      }
      return new Response('unreachable', { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      pushSynapSkillsToOpenwebuiPrompts('/tmp/cwd', HUB_BASE_URL, SECRETS),
    ).rejects.toThrow(/Hub \/skills\/system failed with HTTP 503/);
  });

  it('throws when OpenWebUI admin JWT cannot be forged', async () => {
    vi.mocked(getAdminJwt).mockResolvedValue(null);

    const { fetchMock } = makeFetchMock((call) => {
      if (call.url.endsWith('/api/hub/skills/system')) {
        return new Response(JSON.stringify(SKILL_PACKAGES), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('unexpected', { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      pushSynapSkillsToOpenwebuiPrompts('/tmp/cwd', HUB_BASE_URL, SECRETS),
    ).rejects.toThrow(/OpenWebUI admin JWT unavailable/);
  });
});
