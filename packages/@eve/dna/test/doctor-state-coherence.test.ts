import { describe, expect, it, vi } from 'vitest';
import { runStateCoherenceChecks } from '../src/doctor-state-coherence.js';
import type { EveSecrets } from '../src/secrets-contract.js';

const NOW = new Date('2026-05-09T00:00:00Z');
const FROZEN = () => NOW;

function baseSecrets(overrides: Partial<EveSecrets> = {}): EveSecrets {
  return {
    version: '1',
    updatedAt: NOW.toISOString(),
    synap: { hubBaseUrl: 'https://pod.example.com/api/hub' },
    agents: { eve: { hubApiKey: 'eve-key', agentUserId: 'u', workspaceId: 'w' } },
    ...overrides,
  };
}

function noopFetch(): typeof fetch {
  return (vi.fn(async () => { throw new Error('should not be called'); }) as unknown) as typeof fetch;
}

describe('runStateCoherenceChecks — local', () => {
  it('fails on missing secrets', async () => {
    const checks = await runStateCoherenceChecks(null, { probeRemote: false });
    expect(checks).toHaveLength(1);
    expect(checks[0].status).toBe('fail');
    expect(checks[0].name).toBe('Eve secrets');
  });

  it('warns when no providers configured', async () => {
    const checks = await runStateCoherenceChecks(baseSecrets(), { probeRemote: false, now: FROZEN });
    const provider = checks.find(c => c.name === 'AI providers');
    expect(provider?.status).toBe('warn');
    expect(provider?.message).toMatch(/No providers/);
  });

  it('passes built-in ollama provider', async () => {
    const checks = await runStateCoherenceChecks(
      baseSecrets({ ai: { providers: [{ id: 'ollama' }] } }),
      { probeRemote: false, now: FROZEN },
    );
    const ollama = checks.find(c => c.name.includes('ollama') || c.name.includes('Ollama'));
    expect(ollama?.status).toBe('pass');
  });

  it('fails enabled custom provider missing baseUrl/apiKey', async () => {
    const checks = await runStateCoherenceChecks(
      baseSecrets({ ai: { providers: [{ id: 'custom-foo', name: 'Foo', enabled: true }] } }),
      { probeRemote: false, now: FROZEN },
    );
    const foo = checks.find(c => c.name === 'Provider: Foo');
    expect(foo?.status).toBe('fail');
    expect(foo?.message).toMatch(/baseUrl or apiKey/);
  });

  it('treats enabled:undefined as enabled (matches wire-ai semantics)', async () => {
    const checks = await runStateCoherenceChecks(
      baseSecrets({ ai: { providers: [{ id: 'custom-bar', name: 'Bar', baseUrl: 'https://b', apiKey: 'k' }] } }),
      { probeRemote: false, now: FROZEN },
    );
    expect(checks.find(c => c.name === 'Provider: Bar')?.status).toBe('pass');
  });

  it('fails service routing pointing at unknown provider', async () => {
    const checks = await runStateCoherenceChecks(
      baseSecrets({
        ai: {
          providers: [{ id: 'ollama' }],
          serviceProviders: { hermes: 'ghost-provider' },
        },
      }),
      { probeRemote: false, now: FROZEN },
    );
    const r = checks.find(c => c.name.startsWith('Routing: hermes'));
    expect(r?.status).toBe('fail');
    expect(r?.message).toMatch(/not in providers list/);
  });

  it('warns service routing to disabled provider', async () => {
    const checks = await runStateCoherenceChecks(
      baseSecrets({
        ai: {
          providers: [{ id: 'ollama' }, { id: 'custom-x', baseUrl: 'https://x', apiKey: 'k', enabled: false }],
          serviceProviders: { hermes: 'custom-x' },
        },
      }),
      { probeRemote: false, now: FROZEN },
    );
    const r = checks.find(c => c.name.startsWith('Routing: hermes'));
    expect(r?.status).toBe('warn');
  });

  it('fails enabled channel missing required creds', async () => {
    const checks = await runStateCoherenceChecks(
      baseSecrets({ channels: { telegram: { enabled: true } } }),
      { probeRemote: false, now: FROZEN },
    );
    const tg = checks.find(c => c.name === 'Channel: telegram');
    expect(tg?.status).toBe('fail');
    expect(tg?.message).toMatch(/botToken/);
  });

  it('passes enabled channel with required creds', async () => {
    const checks = await runStateCoherenceChecks(
      baseSecrets({ channels: { telegram: { enabled: true, botToken: 'abc:def' } } }),
      { probeRemote: false, now: FROZEN },
    );
    expect(checks.find(c => c.name === 'Channel: telegram')?.status).toBe('pass');
  });

  it('warns on stale wiringStatus (>7 days)', async () => {
    const eightDaysAgo = new Date(NOW.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString();
    const checks = await runStateCoherenceChecks(
      baseSecrets({
        ai: { wiringStatus: { hermes: { lastApplied: eightDaysAgo, outcome: 'ok' } } },
      }),
      { probeRemote: false, now: FROZEN },
    );
    const h = checks.find(c => c.name === 'Last apply: hermes');
    expect(h?.status).toBe('warn');
    expect(h?.message).toMatch(/8d ago/);
  });

  it('fails wiringStatus with non-ok outcome', async () => {
    const checks = await runStateCoherenceChecks(
      baseSecrets({
        ai: { wiringStatus: { hermes: { lastApplied: NOW.toISOString(), outcome: 'failed: docker not found' } } },
      }),
      { probeRemote: false, now: FROZEN },
    );
    const h = checks.find(c => c.name === 'Last apply: hermes');
    expect(h?.status).toBe('fail');
  });
});

describe('runStateCoherenceChecks — remote probes', () => {
  it('skips Synap probe when no hubBaseUrl', async () => {
    const checks = await runStateCoherenceChecks(
      { version: '1', updatedAt: NOW.toISOString() },
      {
        getAdminJwt: async () => null,
        readEveHubKey: () => null,
        fetch: noopFetch(),
      },
    );
    const hub = checks.find(c => c.name === 'Synap Hub Protocol');
    expect(hub?.status).toBe('skip');
  });

  it('fails Synap probe when 401 from pod', async () => {
    const f = (vi.fn(async () => ({ status: 401, ok: false, json: async () => ({}) })) as unknown) as typeof fetch;
    const checks = await runStateCoherenceChecks(baseSecrets(), {
      getAdminJwt: async () => null,
      fetch: f,
    });
    const hub = checks.find(c => c.name === 'Synap Hub Protocol');
    expect(hub?.status).toBe('fail');
    expect(hub?.message).toMatch(/401/);
  });

  it('skips Synap probe when fetch throws', async () => {
    const f = (vi.fn(async () => { throw new Error('ECONNREFUSED'); }) as unknown) as typeof fetch;
    const checks = await runStateCoherenceChecks(baseSecrets(), {
      getAdminJwt: async () => null,
      fetch: f,
    });
    const hub = checks.find(c => c.name === 'Synap Hub Protocol');
    expect(hub?.status).toBe('skip');
    expect(hub?.message).toMatch(/ECONNREFUSED/);
  });

  it('skips OpenWebUI probes when admin JWT unavailable', async () => {
    const f = (vi.fn(async () => ({ status: 200, ok: true, json: async () => ([]) })) as unknown) as typeof fetch;
    const checks = await runStateCoherenceChecks(baseSecrets(), {
      getAdminJwt: async () => null,
      fetch: f,
    });
    const owui = checks.find(c => c.name === 'OpenWebUI extras');
    expect(owui?.status).toBe('skip');
  });

  it('passes OpenWebUI probes when all three surfaces are present', async () => {
    const responses = new Map<string, unknown>([
      ['/skills/system', { synap: '...', 'synap-schema': '...', 'synap-ui': '...' }],
      ['/api/v1/prompts/', [{ command: 'synap' }, { command: 'synap-schema' }, { command: 'synap-ui' }]],
      ['/api/v1/knowledge/', [{ name: 'Synap Knowledge (openwebui)' }]],
      ['/api/v1/configs/', { tool_server: { connections: [{ name: 'Synap Hub Protocol', url: 'http://x/api/hub/openapi.json' }] } }],
    ]);
    const f = (vi.fn(async (url: string) => {
      const match = [...responses.keys()].find(k => url.includes(k));
      const body = match ? responses.get(match) : null;
      return { status: 200, ok: true, json: async () => body };
    }) as unknown) as typeof fetch;
    const checks = await runStateCoherenceChecks(baseSecrets(), {
      getAdminJwt: async () => 'admin-jwt',
      fetch: f,
    });
    expect(checks.find(c => c.name.includes('skills as Prompts'))?.status).toBe('pass');
    expect(checks.find(c => c.name.includes('knowledge collection'))?.status).toBe('pass');
    expect(checks.find(c => c.name.includes('tool server'))?.status).toBe('pass');
  });

  it('warns OpenWebUI probes when surfaces are missing', async () => {
    const f = (vi.fn(async (url: string) => {
      if (url.includes('/skills/system')) return { status: 200, ok: true, json: async () => ({}) };
      if (url.includes('/api/v1/prompts/')) return { status: 200, ok: true, json: async () => [{ command: 'synap' }] };
      if (url.includes('/api/v1/knowledge/')) return { status: 200, ok: true, json: async () => [] };
      if (url.includes('/api/v1/configs/')) return { status: 200, ok: true, json: async () => ({ tool_server: { connections: [] } }) };
      return { status: 404, ok: false, json: async () => ({}) };
    }) as unknown) as typeof fetch;
    const checks = await runStateCoherenceChecks(baseSecrets(), {
      getAdminJwt: async () => 'admin-jwt',
      fetch: f,
    });
    const skills = checks.find(c => c.name.includes('skills as Prompts'));
    const knowledge = checks.find(c => c.name.includes('knowledge collection'));
    const tools = checks.find(c => c.name.includes('tool server'));
    expect(skills?.status).toBe('warn');
    expect(skills?.message).toMatch(/Missing/);
    expect(knowledge?.status).toBe('warn');
    expect(tools?.status).toBe('warn');
  });
});
