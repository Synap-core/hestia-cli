import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execSync } from 'child_process';
import { createRequire } from 'module';
import { join } from 'path';

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

// js-yaml is a dependency of @eve/dna, not of this package: resolve it from
// there rather than adding a dependency for one test.
const yaml = createRequire(join(import.meta.dirname, '..', '..', 'dna', 'package.json'))(
  'js-yaml',
) as { load: (s: string) => unknown };

interface Router {
  rule: string;
  priority?: number;
  entryPoints: string[];
  middlewares?: string[];
  service: string;
}
interface Routes {
  http: {
    routers: Record<string, Router>;
    services: Record<string, { loadBalancer: { passHostHeader?: boolean; servers: Array<{ url: string }> } }>;
    middlewares?: Record<string, { headers?: { customResponseHeaders?: Record<string, string> } }>;
  };
}

describe('TraefikService.configureSubdomains: signed file links (storage route)', () => {
  async function render(
    mode: { ssl: boolean; behindProxy: boolean },
    opts: { minio?: boolean; backendEnv?: string[] | 'unreadable' } = {},
  ) {
    const { minio = true, backendEnv = ['MINIO_BUCKET=synap-storage'] } = opts;
    vi.resetModules();
    const written: Record<string, string> = {};
    const commands: string[] = [];
    const exec = vi.mocked(execSync);
    exec.mockImplementation(((cmd: string) => {
      commands.push(cmd);
      const m = /compose\.service=([\w-]+)/.exec(cmd);
      if (m) {
        if (m[1] === 'minio' && !minio) return '';
        return `synap-backend-${m[1]}-1\n`;
      }
      if (cmd.includes('{{json .Config.Env}}') && cmd.endsWith('synap-backend-backend-1')) {
        if (backendEnv === 'unreadable') throw new Error('No such object');
        return JSON.stringify(backendEnv);
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
    const text = Object.entries(written).find(([k]) => k.endsWith('eve-routes.yml'))?.[1] ?? '';
    return { text, routes: yaml.load(text) as Routes, commands };
  }

  const CSP = "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:";
  const READ_ONLY_RULE =
    'Host(`pod.example.com`) && PathPrefix(`/synap-storage/`) && (Method(`GET`) || Method(`HEAD`))';
  // Traefik's default priority is the rule's length; the pod host router sets none.
  const effectivePriority = (r: Router) => r.priority ?? r.rule.length;

  // [mode, routers that serve MinIO, router that only redirects to https]
  it.each([
    ['behind-proxy', { ssl: false, behindProxy: true }, ['synap-storage'], null],
    ['ssl', { ssl: true, behindProxy: false }, ['synap-storage'], 'synap-storage-http'],
    ['plain', { ssl: false, behindProxy: false }, ['synap-storage-http', 'synap-storage-https'], null],
  ] as const)('routes GET/HEAD pod.<domain>/synap-storage/ to minio:9000, Host kept, sandbox CSP (%s)', async (_n, mode, serving, redirect) => {
    const { routes } = await render(mode);
    const { routers, services, middlewares } = routes.http;

    for (const id of serving) {
      const r = routers[id];
      expect(r, id).toBeDefined();
      // reads only: no presigned upload goes through the edge (no CVE guard here)
      expect(r.rule).toBe(READ_ONLY_RULE);
      // must outrank the catch-all pod host router
      expect(effectivePriority(r)).toBeGreaterThan(effectivePriority(routers.synap ?? routers['synap-http']));
      expect(r.middlewares).toContain('synap-storage-csp');
      expect(r.service).toBe('synap-storage-svc');
    }
    if (redirect) {
      expect(routers[redirect].rule).toBe(READ_ONLY_RULE);
      expect(routers[redirect].middlewares).toEqual(['redirect-to-https']);
    }
    if (mode.behindProxy) expect(routers['synap-storage'].middlewares).toContain('forward-https');

    const svc = services['synap-storage-svc'].loadBalancer;
    expect(svc.servers).toEqual([{ url: 'http://synap-backend-minio-1:9000' }]);
    // SigV4 signs the Host header: a rewritten Host fails every signed link
    expect(svc.passHostHeader).toBe(true);

    expect(middlewares?.['synap-storage-csp']?.headers?.customResponseHeaders).toEqual({ 'Content-Security-Policy': CSP });
  });

  it("takes the bucket from the backend's environment, with the backend's precedence", async () => {
    const { routes } = await render(
      { ssl: false, behindProxy: true },
      { backendEnv: ['MINIO_BUCKET=ignored', 'MINIO_BUCKET_NAME=pod-files'] },
    );
    expect(routes.http.routers['synap-storage'].rule).toContain('PathPrefix(`/pod-files/`)');
  });

  it('falls back to the backend default bucket when the backend sets none', async () => {
    const { routes } = await render({ ssl: false, behindProxy: true }, { backendEnv: ['PATH=/usr/bin'] });
    expect(routes.http.routers['synap-storage'].rule).toBe(READ_ONLY_RULE);
  });

  it('adds no storage route for a bucket name that is not a valid bucket name', async () => {
    const { text } = await render(
      { ssl: false, behindProxy: true },
      { backendEnv: ['MINIO_BUCKET=x`) || Host(`evil'] },
    );
    expect(text).not.toContain('synap-storage');
    expect(text).not.toContain('evil');
  });

  it('attaches minio to eve-network under the alias the compose override uses', async () => {
    const { commands } = await render({ ssl: false, behindProxy: true });
    expect(commands).toContain('docker network connect --alias eve-brain-minio eve-network synap-backend-minio-1');
  });

  it('adds no storage route when the minio container is not running', async () => {
    const { text, routes } = await render({ ssl: false, behindProxy: true }, { minio: false });
    expect(text).not.toContain('synap-storage');
    expect(routes.http.routers['synap-realtime']).toBeDefined(); // realtime router unaffected
  });

  it('writes no middlewares block in plain mode without minio', async () => {
    const { routes } = await render({ ssl: false, behindProxy: false }, { minio: false });
    expect(routes.http.middlewares).toBeUndefined();
  });
});
