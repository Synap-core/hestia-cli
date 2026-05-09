import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  writeEveSecrets,
  readEveSecrets,
  type EveSecrets,
} from '../src/secrets-contract.js';
import { configStore } from '../src/config-store.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'eve-migration-'));

describe('provider list migration (customProviders → providers)', () => {
  let dir: string;
  const originalEveHome = process.env['EVE_HOME'];

  beforeEach(() => {
    dir = tmp();
    process.env['EVE_HOME'] = dir;
    configStore.reset();
  });

  afterEach(() => {
    if (originalEveHome === undefined) delete process.env['EVE_HOME'];
    else process.env['EVE_HOME'] = originalEveHome;
    configStore.reset();
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('merges legacy customProviders into providers and drops the legacy field', async () => {
    const legacyAi = {
      mode: 'local' as const,
      providers: [{ id: 'ollama', enabled: true, baseUrl: 'http://localhost:11434' }],
      customProviders: [{ id: 'custom-my-llm', name: 'My LLM', baseUrl: 'http://my.llm.local', enabled: true }],
    };

    const result = await writeEveSecrets(
      { ai: legacyAi as EveSecrets['ai'] },
      dir,
    );

    expect(result.ai?.providers).toHaveLength(2);
    expect(result.ai?.providers?.find(p => p.id === 'ollama')).toBeDefined();
    expect(result.ai?.providers?.find(p => p.id === 'custom-my-llm')).toBeDefined();
    expect(result.ai?.providers?.find(p => p.id === 'custom-my-llm')?.name).toBe('My LLM');
    expect((result.ai as Record<string, unknown>)?.['customProviders']).toBeUndefined();
  });

  it('is idempotent — already-unified state is not double-merged on re-write', async () => {
    await writeEveSecrets(
      {
        ai: {
          providers: [{ id: 'ollama', enabled: true }],
          customProviders: [{ id: 'custom-foo', name: 'Foo' }],
        } as EveSecrets['ai'],
      },
      dir,
    );

    const afterFirst = await readEveSecrets(dir);
    const result = await writeEveSecrets({ ai: afterFirst?.ai }, dir);

    expect(result.ai?.providers).toHaveLength(2);
  });

  it('state schema version is "1" after migration', async () => {
    const result = await writeEveSecrets(
      { synap: { apiUrl: 'http://localhost:4000' } },
      dir,
    );
    expect(result.version).toBe('1');
    expect(result.updatedAt).toBeTruthy();
  });
});

describe('secrets schema round-trip — all top-level sections survive write/read', () => {
  let dir: string;
  const originalEveHome = process.env['EVE_HOME'];

  beforeEach(() => {
    dir = tmp();
    process.env['EVE_HOME'] = dir;
    configStore.reset();
  });

  afterEach(() => {
    if (originalEveHome === undefined) delete process.env['EVE_HOME'];
    else process.env['EVE_HOME'] = originalEveHome;
    configStore.reset();
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('persists and retrieves synap, ai, and domain fields without corruption', async () => {
    const written = await writeEveSecrets({
      synap: { apiUrl: 'http://synap.local', apiKey: 'key-abc' },
      ai: { mode: 'hybrid', defaultProvider: 'anthropic' },
    }, dir);

    const read = await readEveSecrets(dir);

    expect(read?.synap?.apiUrl).toBe('http://synap.local');
    expect(read?.synap?.apiKey).toBe('key-abc');
    expect(read?.ai?.mode).toBe('hybrid');
    expect(read?.ai?.defaultProvider).toBe('anthropic');
    expect(read?.version).toBe(written.version);
  });

  it('partial write merges into existing state without clobbering unrelated fields', async () => {
    await writeEveSecrets({ synap: { apiUrl: 'http://synap.local', apiKey: 'key-abc' } }, dir);
    await writeEveSecrets({ ai: { mode: 'local' } }, dir);

    const read = await readEveSecrets(dir);

    expect(read?.synap?.apiUrl).toBe('http://synap.local');
    expect(read?.synap?.apiKey).toBe('key-abc');
    expect(read?.ai?.mode).toBe('local');
  });
});
