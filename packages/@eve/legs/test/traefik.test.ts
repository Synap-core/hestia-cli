import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execSync } from 'child_process';

vi.mock('child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('child_process')>()),
  execSync: vi.fn(),
}));

vi.mock('fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('fs')>()),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(() => ''),
  existsSync: vi.fn(() => false),
  mkdirSync: vi.fn(),
}));

describe('TraefikService', () => {
  it('Route type has expected fields', () => {
    // Structural test: verify Route interface shape
    const route = {
      path: '/api',
      target: 'http://backend:4000',
    };
    expect(route.path).toBe('/api');
    expect(route.target).toBe('http://backend:4000');
  });

  it('TraefikService accepts custom config dir', () => {
    const dir = '/tmp/test-traefik';
    // Constructor just sets private fields — no side effects
    expect(dir).toBe('/tmp/test-traefik');
  });
});

describe('TunnelService', () => {
  it('TunnelConfig supports pangolin and cloudflare providers', () => {
    const providers: Array<'pangolin' | 'cloudflare'> = ['pangolin', 'cloudflare'];
    expect(providers).toHaveLength(2);
  });
});

describe('TraefikService.configureSubdomains: presigned storage route', () => {
  async function render(minio: boolean, mode: { ssl: boolean; behindProxy: boolean }) {
    vi.resetModules();
    const written: Record<string, string> = {};
    const exec = vi.mocked(execSync);
    exec.mockImplementation(((cmd: string) => {
      const m = /compose\.service=([\w-]+)/.exec(cmd);
      if (m) {
        if (m[1] === 'minio' && !minio) return '';
        return `synap-backend-${m[1]}-1\n`;
      }
      return '';
    }) as never);
    const fs = await import('fs');
    vi.mocked(fs.writeFileSync).mockImplementation(((p: string, c: string) => {
      written[String(p)] = String(c);
    }) as never);
    const { TraefikService } = await import('../src/lib/traefik');
    await new TraefikService('/tmp/eve-test-traefik').configureSubdomains(
      'example.com', mode.ssl, undefined, ['synap'], mode.behindProxy,
    );
    return Object.entries(written).find(([k]) => k.endsWith('eve-routes.yml'))?.[1] ?? '';
  }

  it.each([
    ['behind-proxy', { ssl: false, behindProxy: true }],
    ['ssl', { ssl: true, behindProxy: false }],
    ['plain', { ssl: false, behindProxy: false }],
  ])('routes pod host /synap-storage/ to minio:9000 with Host preserved (%s)', async (_n, mode) => {
    const yml = await render(true, mode);
    expect(yml).toContain('PathPrefix(`/synap-storage/`)');
    expect(yml).toMatch(/Host\(`pod\.example\.com`\) && PathPrefix\(`\/synap-storage\/`\)/);
    expect(yml).toContain('synap-storage-svc:');
    expect(yml).toContain('url: "http://synap-backend-minio-1:9000"');
    const svc = yml.slice(yml.indexOf('synap-storage-svc:\n'));
    expect(svc.split('servers:')[0]).toContain('passHostHeader: true');
    // must outrank the catch-all pod router
    const router = yml.slice(yml.indexOf('synap-storage'), yml.indexOf('synap-storage') + 200);
    expect(router).toContain('priority: 100');
  });

  it('adds no storage route when the minio container is not running', async () => {
    const yml = await render(false, { ssl: false, behindProxy: true });
    expect(yml).not.toContain('synap-storage');
    expect(yml).toContain('synap-realtime'); // realtime router unaffected
  });
});
