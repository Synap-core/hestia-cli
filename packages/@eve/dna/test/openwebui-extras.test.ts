import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { EveSecrets } from '../src/secrets-contract.js';

const skillsMock = vi.fn();
const knowledgeMock = vi.fn();
const toolsMock = vi.fn();

vi.mock('../src/openwebui-skills-sync.js', () => ({
  pushSynapSkillsToOpenwebuiPrompts: (...args: unknown[]) => skillsMock(...args),
}));
vi.mock('../src/openwebui-knowledge-sync.js', () => ({
  syncSynapKnowledgeToOpenwebui: (...args: unknown[]) => knowledgeMock(...args),
}));
vi.mock('../src/openwebui-tools-sync.js', () => ({
  registerSynapAsOpenwebuiToolServer: (...args: unknown[]) => toolsMock(...args),
}));

import { syncOpenwebuiExtras, formatExtrasSummary } from '../src/openwebui-extras.js';

const SECRETS_WITH_HUB: EveSecrets = {
  version: '1',
  updatedAt: new Date().toISOString(),
  synap: { apiUrl: 'https://pod.example.com', hubBaseUrl: 'https://pod.example.com/api/hub' },
};

const SECRETS_NO_HUB: EveSecrets = {
  version: '1',
  updatedAt: new Date().toISOString(),
};

describe('syncOpenwebuiExtras', () => {
  beforeEach(() => {
    skillsMock.mockReset();
    knowledgeMock.mockReset();
    toolsMock.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('skips when secrets is null', async () => {
    const r = await syncOpenwebuiExtras('/cwd', null);
    expect(r.skipped).toBe(true);
    expect(skillsMock).not.toHaveBeenCalled();
    expect(knowledgeMock).not.toHaveBeenCalled();
    expect(toolsMock).not.toHaveBeenCalled();
  });

  it('skips when no hubBaseUrl can be resolved', async () => {
    const r = await syncOpenwebuiExtras('/cwd', SECRETS_NO_HUB);
    expect(r.skipped).toBe(true);
    expect(skillsMock).not.toHaveBeenCalled();
  });

  it('runs all three helpers in parallel and returns ok outcomes', async () => {
    skillsMock.mockResolvedValue({ synced: [], created: 3, updated: 0, skipped: [] });
    knowledgeMock.mockResolvedValue({ collectionId: 'c1', added: 5, updated: 1, removed: 0, skipped: [] });
    toolsMock.mockResolvedValue({ registered: true, toolCount: 30, serverName: 'Synap Hub Protocol', endpointUrl: 'http://eve-brain-synap:4000/api/hub/openapi.json' });

    const r = await syncOpenwebuiExtras('/cwd', SECRETS_WITH_HUB);

    expect(r.skipped).toBe(false);
    expect(r.skills?.ok).toBe(true);
    expect(r.knowledge?.ok).toBe(true);
    expect(r.tools?.ok).toBe(true);
    expect(skillsMock).toHaveBeenCalledTimes(1);
    expect(knowledgeMock).toHaveBeenCalledTimes(1);
    expect(toolsMock).toHaveBeenCalledTimes(1);
  });

  it('captures per-helper failures without throwing', async () => {
    skillsMock.mockRejectedValue(new Error('hub down'));
    knowledgeMock.mockResolvedValue({ collectionId: 'c1', added: 0, updated: 0, removed: 0, skipped: [] });
    toolsMock.mockResolvedValue({ registered: false, toolCount: 0, serverName: 'Synap Hub Protocol', endpointUrl: '' });

    const r = await syncOpenwebuiExtras('/cwd', SECRETS_WITH_HUB);

    expect(r.skills?.ok).toBe(false);
    if (r.skills && !r.skills.ok) expect(r.skills.error).toBe('hub down');
    expect(r.knowledge?.ok).toBe(true);
    expect(r.tools?.ok).toBe(true);
  });

  it('forwards knowledge options to the knowledge helper', async () => {
    skillsMock.mockResolvedValue({ synced: [], created: 0, updated: 0, skipped: [] });
    knowledgeMock.mockResolvedValue({ collectionId: 'c1', added: 0, updated: 0, removed: 0, skipped: [] });
    toolsMock.mockResolvedValue({ registered: true, toolCount: 0, serverName: '', endpointUrl: '' });

    await syncOpenwebuiExtras('/cwd', SECRETS_WITH_HUB, { knowledge: { namespace: 'shared', maxEntries: 100 } });

    expect(knowledgeMock).toHaveBeenCalledWith(
      '/cwd',
      'https://pod.example.com/api/hub',
      SECRETS_WITH_HUB,
      { namespace: 'shared', maxEntries: 100 },
    );
  });
});

describe('formatExtrasSummary', () => {
  it('reports skipped state', () => {
    expect(formatExtrasSummary({ skipped: true })).toBe('OpenWebUI extras: skipped (no Hub URL)');
  });

  it('formats success across all three surfaces', () => {
    const s = formatExtrasSummary({
      skipped: false,
      skills: { ok: true, result: { synced: [], created: 2, updated: 1, skipped: [] } },
      knowledge: { ok: true, result: { collectionId: 'c1', added: 3, updated: 0, removed: 1, skipped: [] } },
      tools: { ok: true, result: { registered: true, toolCount: 30, serverName: 'Synap Hub Protocol', endpointUrl: '' } },
    });
    expect(s).toContain('skills: created=2 updated=1 skipped=0');
    expect(s).toContain('knowledge: +3/~0/-1 skipped=0');
    expect(s).toContain('tools: registered 30 ops');
  });

  it('formats per-surface errors', () => {
    const s = formatExtrasSummary({
      skipped: false,
      skills: { ok: false, error: 'hub timeout' },
      knowledge: { ok: false, error: 'admin login failed' },
      tools: { ok: true, result: { registered: false, toolCount: 0, serverName: '', endpointUrl: '' } },
    });
    expect(s).toContain('skills: error (hub timeout)');
    expect(s).toContain('knowledge: error (admin login failed)');
    expect(s).toContain('tools: not registered');
  });
});
