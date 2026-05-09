import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ensureSecretValue,
  writeEveSecrets,
  readEveSecrets,
  secretsPath,
} from '../src/secrets-contract.js';
import { configStore } from '../src/config-store.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'eve-secrets-'));

describe('ensureSecretValue', () => {
  it('returns existing non-empty value', () => {
    expect(ensureSecretValue('my-key')).toBe('my-key');
  });

  it('generates a fallback for empty string', () => {
    const result = ensureSecretValue('');
    expect(result.length).toBeGreaterThan(0);
  });

  it('generates a fallback for whitespace', () => {
    const result = ensureSecretValue('  ');
    expect(result.length).toBeGreaterThan(0);
  });

  it('generates a fallback for undefined', () => {
    const result = ensureSecretValue(undefined as any);
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('writeEveSecrets / readEveSecrets', () => {
  let dir: string;
  beforeEach(() => {
    dir = tmp();
  });
  afterAll(() => {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('writes and reads a partial secret', async () => {
    const written = await writeEveSecrets({
      synap: { apiUrl: 'http://localhost:4000' },
    }, dir);
    expect(written.synap?.apiUrl).toBe('http://localhost:4000');
    expect(written.version).toBe('1');
  });

  it('merges nested secrets (keeps existing when partial is missing)', async () => {
    await writeEveSecrets({
      synap: { apiUrl: 'http://localhost:4000', apiKey: 'key1' },
    }, dir);
    await writeEveSecrets({
      synap: { hubBaseUrl: 'http://localhost:4000/api/hub' },
    }, dir);
    const read = await readEveSecrets(dir);
    expect(read?.synap?.apiUrl).toBe('http://localhost:4000');
    expect(read?.synap?.apiKey).toBe('key1');
    expect(read?.synap?.hubBaseUrl).toBe('http://localhost:4000/api/hub');
  });

  it('returns null for non-existent file', async () => {
    const newDir = tmp();
    try {
      const result = await readEveSecrets(newDir);
      expect(result).toBeNull();
    } finally {
      rmSync(newDir, { recursive: true, force: true });
    }
  });

  it('writes secrets to .eve/secrets/secrets.json', () => {
    const path = secretsPath(dir);
    expect(path).toBe(join(dir, '.eve', 'secrets', 'secrets.json'));
  });
});

describe('configStore', () => {
  const originalEveHome = process.env.EVE_HOME;
  let dir: string;

  beforeEach(() => {
    dir = tmp();
    process.env.EVE_HOME = dir;
    configStore.reset();
  });

  afterAll(() => {
    process.env.EVE_HOME = originalEveHome;
    configStore.reset();
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('refreshes the cached secrets after writeEveSecrets', async () => {
    await writeEveSecrets({ synap: { apiUrl: 'http://one.local' } }, dir);
    expect((await configStore.get())?.synap?.apiUrl).toBe('http://one.local');

    await writeEveSecrets({ synap: { apiUrl: 'http://two.local' } }, dir);
    expect((await configStore.get())?.synap?.apiUrl).toBe('http://two.local');
  });
});
