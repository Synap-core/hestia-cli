import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configStore } from '../src/config-store.js';
import { readEveSecrets, writeEveSecrets } from '../src/secrets-contract.js';
import { discoverAndBackfillPodConfig, discoverAndBackfillPodUrl } from '../src/discover.js';

const mockedFs = vi.hoisted(() => ({
  files: new Map<string, string>(),
}));

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    existsSync: (path: string) => {
      if (mockedFs.files.has(path)) return true;
      return actual.existsSync(path);
    },
    readFileSync: (path: string, options?: BufferEncoding | { encoding?: BufferEncoding } | null) => {
      const mocked = mockedFs.files.get(path);
      if (mocked !== undefined) return mocked;
      return actual.readFileSync(path, options as BufferEncoding);
    },
  };
});

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  return {
    ...actual,
    execSync: vi.fn(() => {
      throw new Error('docker unavailable in test');
    }),
  };
});

const tmp = () => mkdtempSync(join(tmpdir(), 'eve-discover-'));

describe('discoverAndBackfillPodConfig', () => {
  let dir: string;

  beforeEach(() => {
    dir = tmp();
    mockedFs.files.clear();
    configStore.reset();
  });

  afterEach(() => {
    configStore.reset();
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  afterAll(() => {
    mockedFs.files.clear();
  });

  it('writes discovered domain and explicit PUBLIC_URL to secrets', async () => {
    mockedFs.files.set('/opt/synap-backend/.env', [
      'DOMAIN=example.org',
      'PUBLIC_URL=https://pod.example.org',
      'PROVISIONING_TOKEN=token-1',
    ].join('\n'));

    await writeEveSecrets({ synap: { apiKey: 'existing-key' } }, dir);

    const discovered = await discoverAndBackfillPodConfig(dir);
    const secrets = await readEveSecrets(dir);

    expect(discovered).toMatchObject({
      domain: 'example.org',
      synapUrl: 'https://pod.example.org',
      provisioningToken: 'token-1',
      backfilled: true,
    });
    expect(secrets?.domain?.primary).toBe('example.org');
    expect(secrets?.synap?.apiUrl).toBe('https://pod.example.org');
    expect(secrets?.synap?.apiKey).toBe('existing-key');
  });

  it('backfills domain-only discovery without keeping stale derived apiUrl', async () => {
    mockedFs.files.set('/opt/synap-backend/.env', 'DOMAIN=example.org\n');
    await writeEveSecrets({ synap: { apiUrl: 'https://pod.example.org' } }, dir);

    const discovered = await discoverAndBackfillPodConfig(dir);
    const secrets = await readEveSecrets(dir);

    expect(discovered).toMatchObject({
      domain: 'example.org',
      synapUrl: undefined,
      backfilled: true,
    });
    expect(secrets?.domain?.primary).toBe('example.org');
    expect(secrets?.synap?.apiUrl).toBe('');
  });

  it('can run discovery without writing during dry runs', async () => {
    mockedFs.files.set('/opt/synap-backend/.env', 'DOMAIN=example.org\n');

    const discovered = await discoverAndBackfillPodConfig(dir, { backfill: false });
    const secrets = await readEveSecrets(dir);

    expect(discovered.domain).toBe('example.org');
    expect(discovered.backfilled).toBe(false);
    expect(secrets).toBeNull();
  });

  it('returns the conventional pod URL when only DOMAIN is discovered', async () => {
    mockedFs.files.set('/opt/synap-backend/.env', 'DOMAIN=example.org\n');

    await expect(discoverAndBackfillPodUrl(dir)).resolves.toBe('https://pod.example.org');
  });
});
