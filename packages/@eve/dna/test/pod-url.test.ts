import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resolvePodUrl, resolvePodUrlDetailed, resetPodUrlCache } from '../src/pod-url.js';

const mocked = vi.hoisted(() => ({
  secrets: null as unknown,
  discoveryUrl: undefined as string | undefined,
  loopbackReachable: false,
  dockerDnsReachable: false,
}));

vi.mock('../src/config-store.js', () => ({
  configStore: {
    get: vi.fn(async () => mocked.secrets),
    reset: vi.fn(),
  },
}));

vi.mock('../src/discover.js', () => ({
  discoverAndBackfillPodUrl: vi.fn(async () => mocked.discoveryUrl),
}));

vi.mock('node:net', () => ({
  Socket: class {
    private handlers = new Map<string, (...args: unknown[]) => void>();

    once(event: string, handler: (...args: unknown[]) => void): this {
      this.handlers.set(event, handler);
      return this;
    }

    connect(port: number, host: string): void {
      const reachable =
        (host === '127.0.0.1' && port === 14000 && mocked.loopbackReachable) ||
        (host === 'eve-brain-synap' && port === 4000 && mocked.dockerDnsReachable);
      queueMicrotask(() => {
        this.handlers.get(reachable ? 'connect' : 'error')?.(new Error('unreachable'));
      });
    }

    destroy(): void {
      // No-op in tests.
    }
  },
}));

describe('resolvePodUrlDetailed', () => {
  beforeEach(() => {
    mocked.secrets = null;
    mocked.discoveryUrl = undefined;
    mocked.loopbackReachable = false;
    mocked.dockerDnsReachable = false;
    delete process.env.NEXT_PUBLIC_POD_URL;
    resetPodUrlCache();
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_POD_URL;
    resetPodUrlCache();
  });

  it('tracks explicit/env configuration as env source', async () => {
    const result = await resolvePodUrlDetailed(' https://pod.example.com ');

    expect(result).toMatchObject({
      podUrl: 'https://pod.example.com',
      source: 'env',
    });
    expect(result.diagnostics[0]?.code).toBe('pod_url.env');
  });

  it('tracks secrets as secrets source', async () => {
    mocked.secrets = { synap: { apiUrl: ' https://pod.secret.test ' } };

    const result = await resolvePodUrlDetailed();

    expect(result).toMatchObject({
      podUrl: 'https://pod.secret.test',
      source: 'secrets',
    });
  });

  it('keeps domain-derived secrets URLs on pod subdomain', async () => {
    mocked.secrets = { domain: { primary: 'example.org' } };

    const result = await resolvePodUrlDetailed();

    expect(result).toMatchObject({
      podUrl: 'https://pod.example.org',
      source: 'secrets',
    });
  });

  it('tracks request host derivation as headers source', async () => {
    const headers = new Headers({
      'x-forwarded-host': 'eve.example.net',
      'x-forwarded-proto': 'https',
    });

    const result = await resolvePodUrlDetailed(undefined, '/api/pod/setup-status', headers);

    expect(result).toMatchObject({
      podUrl: 'https://pod.example.net',
      source: 'headers',
    });
  });

  it('tracks discovery source', async () => {
    mocked.discoveryUrl = 'https://pod.discovered.test';

    const result = await resolvePodUrlDetailed();

    expect(result).toMatchObject({
      podUrl: 'https://pod.discovered.test',
      source: 'discovery',
    });
  });

  it('tracks loopback and docker DNS fallbacks', async () => {
    mocked.loopbackReachable = true;
    await expect(resolvePodUrlDetailed()).resolves.toMatchObject({
      podUrl: 'http://127.0.0.1:14000',
      source: 'loopback',
    });

    resetPodUrlCache();
    mocked.loopbackReachable = false;
    mocked.dockerDnsReachable = true;
    await expect(resolvePodUrlDetailed()).resolves.toMatchObject({
      podUrl: 'http://eve-brain-synap:4000',
      source: 'docker-dns',
    });
  });

  it('returns none source when every resolver path fails', async () => {
    const result = await resolvePodUrlDetailed();

    expect(result.podUrl).toBe('');
    expect(result.source).toBe('none');
    expect(result.diagnostics.at(-1)).toMatchObject({
      level: 'error',
      code: 'pod_url.none',
    });
  });

  it('keeps resolvePodUrl as a string-only delegate', async () => {
    mocked.discoveryUrl = 'https://pod.delegate.test';

    await expect(resolvePodUrl()).resolves.toBe('https://pod.delegate.test');
  });
});
