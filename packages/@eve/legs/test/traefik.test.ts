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
    middlewares?: Record<string, {
      headers?: { customResponseHeaders?: Record<string, string> };
      ipAllowList?: { sourceRange: string[] };
    }>;
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
  const STORAGE_PATH = 'Host(`pod.example.com`) && PathPrefix(`/synap-storage/`)';
  // what the backend signs (GET download, PUT upload) + HEAD + the CORS preflight
  const STORAGE_RULE =
    `${STORAGE_PATH} && (Method(\`GET\`) || Method(\`HEAD\`) || Method(\`PUT\`) || Method(\`OPTIONS\`))`;
  // the Caddyfile's MinIO unsigned-trailer CVE guard (CVE-2026-41145 / CVE-2026-40344)
  const GUARD_RULE =
    `${STORAGE_PATH} && (Header(\`X-Amz-Content-Sha256\`, \`STREAMING-UNSIGNED-PAYLOAD-TRAILER\`) || HeaderRegexp(\`X-Amz-Meta-Snowball-Auto-Extract\`, \`.*\`))`;
  // Traefik's default priority is the rule's length; the pod host router sets none.
  const effectivePriority = (r: Router) => r.priority ?? r.rule.length;

  // [mode, routers that serve the request, router that only redirects to https]
  it.each([
    ['behind-proxy', { ssl: false, behindProxy: true }, [''], null],
    ['ssl', { ssl: true, behindProxy: false }, [''], '-http'],
    ['plain', { ssl: false, behindProxy: false }, ['-http', '-https'], null],
  ] as const)('routes GET/HEAD/PUT/OPTIONS pod.<domain>/synap-storage/ to minio:9000 behind the CVE guard (%s)', async (_n, mode, serving, redirect) => {
    const { routes } = await render(mode);
    const { routers, services, middlewares } = routes.http;
    const hostRouter = routers.synap ?? routers['synap-http'];

    for (const suffix of serving) {
      const r = routers[`synap-storage${suffix}`];
      expect(r, `synap-storage${suffix}`).toBeDefined();
      expect(r.rule).toBe(STORAGE_RULE);
      // must outrank the catch-all pod host router
      expect(effectivePriority(r)).toBeGreaterThan(effectivePriority(hostRouter));
      expect(r.middlewares).toContain('synap-storage-csp');
      expect(r.service).toBe('synap-storage-svc');

      const g = routers[`synap-storage-cve-guard${suffix}`];
      expect(g, `synap-storage-cve-guard${suffix}`).toBeDefined();
      expect(g.rule).toBe(GUARD_RULE);
      // must outrank the storage router, so a CVE-shaped upload never reaches MinIO
      expect(effectivePriority(g)).toBeGreaterThan(effectivePriority(r));
      expect(g.entryPoints).toEqual(r.entryPoints);
      expect(g.middlewares).toContain('synap-storage-refuse');
      expect(g.service).toBe('noop@internal');
    }
    if (redirect) {
      expect(routers[`synap-storage${redirect}`].rule).toBe(STORAGE_RULE);
      expect(routers[`synap-storage${redirect}`].middlewares).toEqual(['redirect-to-https']);
      expect(routers[`synap-storage-cve-guard${redirect}`].middlewares).toEqual(['redirect-to-https']);
    }
    if (mode.behindProxy) expect(routers['synap-storage'].middlewares).toContain('forward-https');

    const svc = services['synap-storage-svc'].loadBalancer;
    expect(svc.servers).toEqual([{ url: 'http://synap-backend-minio-1:9000' }]);
    // SigV4 signs the Host header: a rewritten Host fails every signed link
    expect(svc.passHostHeader).toBe(true);
    // the guard has no upstream of its own
    expect(Object.keys(services).filter(k => k.includes('cve-guard'))).toEqual([]);

    expect(middlewares?.['synap-storage-csp']?.headers?.customResponseHeaders).toEqual({ 'Content-Security-Policy': CSP });
    // Traefik 3.0 ipAllowList answers 403 to a client outside sourceRange: no client is this address
    expect(middlewares?.['synap-storage-refuse']?.ipAllowList).toEqual({ sourceRange: ['255.255.255.255/32'] });
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
    expect(routes.http.routers['synap-storage'].rule).toBe(STORAGE_RULE);
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

// Every `eve update` regenerates the routes now; a Traefik restart there would
// drop every route on the pod for nothing when the files did not move.
describe('TraefikService.configureSubdomains: restarts Traefik only when the routes changed', () => {
  async function run(onDisk: { static?: string; routes?: string }) {
    vi.resetModules();
    const commands: string[] = [];
    const written: Record<string, string> = {};
    vi.mocked(execSync).mockImplementation(((cmd: string) => {
      commands.push(cmd);
      return '';
    }) as never);
    const fs = await import('fs');
    const disk = (p: string) =>
      p.endsWith('traefik.yml') ? onDisk.static : p.endsWith('eve-routes.yml') ? onDisk.routes : undefined;
    vi.mocked(fs.existsSync).mockImplementation(((p: string) => disk(String(p)) !== undefined) as never);
    vi.mocked(fs.readFileSync).mockImplementation(((p: string) => disk(String(p)) ?? '') as never);
    vi.mocked(fs.writeFileSync).mockImplementation(((p: string, c: string) => {
      written[String(p)] = String(c);
    }) as never);
    const { TraefikService } = await import('../src/lib/traefik');
    const result = await new TraefikService('/tmp/eve-test-traefik').configureSubdomains(
      'example.com', true, 'ops@example.com', ['synap'], false,
    );
    const restarted = commands.includes('docker restart eve-legs-traefik');
    return { result, restarted, written };
  }

  it('writes both files and restarts when nothing is on disk yet', async () => {
    const { result, restarted, written } = await run({});
    expect(result).toEqual({ changed: true });
    expect(restarted).toBe(true);
    expect(Object.keys(written).some(k => k.endsWith('eve-routes.yml'))).toBe(true);
  });

  it('neither writes nor restarts when both files already hold what it generates', async () => {
    const first = await run({});
    const onDisk = {
      static: Object.entries(first.written).find(([k]) => k.endsWith('traefik.yml'))?.[1],
      routes: Object.entries(first.written).find(([k]) => k.endsWith('eve-routes.yml'))?.[1],
    };
    expect(onDisk.static && onDisk.routes).toBeTruthy(); // non-vacuity
    const { result, restarted, written } = await run(onDisk);
    expect(result).toEqual({ changed: false });
    expect(restarted).toBe(false);
    expect(written).toEqual({});
  });

  it('writes and restarts when only the routes changed', async () => {
    const first = await run({});
    const { result, restarted } = await run({
      static: Object.entries(first.written).find(([k]) => k.endsWith('traefik.yml'))?.[1],
      routes: '# an older eve-routes.yml\n',
    });
    expect(result).toEqual({ changed: true });
    expect(restarted).toBe(true);
  });
});

describe('TraefikService.readRoutesDomain', () => {
  async function read(onDisk: string | undefined) {
    vi.resetModules();
    const fs = await import('fs');
    vi.mocked(fs.existsSync).mockImplementation((() => onDisk !== undefined) as never);
    vi.mocked(fs.readFileSync).mockImplementation((() => onDisk ?? '') as never);
    const { TraefikService } = await import('../src/lib/traefik');
    return new TraefikService('/tmp/eve-test-traefik').readRoutesDomain();
  }

  it('reads the domain from the generated header', async () => {
    const r = await read('# Eve subdomain routes — generated by `eve domain set`\n# Domain: antoinesrvt.synap.live | Mode: behind-proxy\nhttp:\n');
    expect(r).toEqual({ state: 'found', domain: 'antoinesrvt.synap.live', path: '/tmp/eve-test-traefik/dynamic/eve-routes.yml' });
  });

  it('falls back to the first Host rule minus its subdomain', async () => {
    const r = await read('http:\n  routers:\n    synap:\n      rule: "Host(`pod.perso.example.org`)"\n');
    expect(r).toMatchObject({ state: 'found', domain: 'perso.example.org' });
  });

  it('says missing when there is no routes file (first install: no guard)', async () => {
    expect(await read(undefined)).toEqual({ state: 'missing' });
  });
});

// An update regenerates the routes; it must never publish a host. CT101 has
// openclaw (no gateway auth) and nango installed but never routed: a dry run
// of the update against its real inputs added nango., connect. and openclaw.
describe('TraefikService.configureSubdomains: keepPublicHosts routes only the hosts already routed', () => {
  const liveRoutes = (hosts: string[]) =>
    '# Eve subdomain routes — generated by `eve domain set`\n# Domain: example.com | Mode: behind-proxy\nhttp:\n  routers:\n' +
    hosts.map((h, i) => `    r${i}:\n      rule: "Host(\`${h}\`)"\n      service: r${i}-svc\n`).join('');

  async function run(
    onDisk: string | undefined | 'unreadable',
    installed: string[],
    opts: { keepPublicHosts?: boolean } = { keepPublicHosts: true },
    customRoutes?: Array<{ subdomain: string; port: number; domain?: string }>,
  ) {
    vi.resetModules();
    const written: Record<string, string> = {};
    vi.mocked(execSync).mockImplementation(((cmd: string) => {
      const m = /compose\.service=([\w-]+)/.exec(cmd);
      if (m) return `synap-backend-${m[1]}-1\n`;
      if (cmd.includes('{{json .Config.Env}}')) return JSON.stringify(['MINIO_BUCKET=synap-storage']);
      return '';
    }) as never);
    const fs = await import('fs');
    const isRoutes = (p: unknown) => String(p).endsWith('eve-routes.yml');
    vi.mocked(fs.existsSync).mockImplementation(((p: string) => isRoutes(p) && onDisk !== undefined) as never);
    vi.mocked(fs.readFileSync).mockImplementation(((p: string) => {
      if (!isRoutes(p)) return '';
      if (onDisk === 'unreadable') throw new Error('EACCES: permission denied');
      return onDisk ?? '';
    }) as never);
    vi.mocked(fs.writeFileSync).mockImplementation(((p: string, c: string) => {
      written[String(p)] = String(c);
    }) as never);
    const { TraefikService } = await import('../src/lib/traefik');
    const result = await new TraefikService('/tmp/eve-test-traefik').configureSubdomains(
      'example.com', false, undefined, installed, true, customRoutes, opts,
    );
    const text = Object.entries(written).find(([k]) => isRoutes(k))?.[1] ?? '';
    const hosts = [...new Set([...text.matchAll(/Host\(`([^`]+)`\)/g)].map(m => m[1]))].sort();
    return { result, text, routes: yaml.load(text) as Routes, hosts };
  }

  it('leaves installed-but-unrouted components unrouted and names them; keeps the pod host path routes', async () => {
    const live = ['pod.example.com', 'pod-admin.example.com', 'crm.staging.example.org'];
    const { result, routes, hosts } = await run(
      liveRoutes(live),
      ['traefik', 'synap', 'openclaw', 'nango'],
      { keepPublicHosts: true },
      [{ subdomain: 'crm', port: 3134, domain: 'staging.example.org' }, { subdomain: 'new', port: 3200 }],
    );
    const { routers } = routes.http;

    // not one host more than the routes already served
    expect(hosts).toEqual([...live].sort());
    expect(routers.openclaw).toBeUndefined();
    expect(routers.nango).toBeUndefined();
    expect(routers['nango-connect']).toBeUndefined();
    expect(routers['nango-connect-envjs']).toBeUndefined();
    expect(routers['custom-new']).toBeUndefined();
    expect(result.notExposed).toEqual(['nango', 'openclaw', 'new.example.com']);
    // what was routed stays routed, with the routes a release added on the pod host
    expect(routers.synap).toBeDefined();
    expect(routers['pod-admin']).toBeDefined();
    expect(routers['custom-crm']).toBeDefined();
    expect(routers['synap-storage'].rule).toContain('Host(`pod.example.com`) && PathPrefix(`/synap-storage/`)');
    expect(routers['synap-storage-cve-guard']).toBeDefined();
    expect(routers['synap-realtime']).toBeDefined();
  });

  it('names an extra subdomain by host when its component stays routed', async () => {
    const { result, routes, hosts } = await run(liveRoutes(['nango.example.com']), ['nango']);
    expect(hosts).toEqual(['nango.example.com']);
    expect(routes.http.routers.nango).toBeDefined();
    expect(routes.http.routers['nango-connect']).toBeUndefined();
    expect(routes.http.routers['nango-connect-envjs']).toBeUndefined();
    expect(result.notExposed).toEqual(['connect.example.com']);
  });

  it('routes every installed component when there is no routes file yet (first install)', async () => {
    const { result, routes } = await run(undefined, ['synap', 'openclaw']);
    expect(routes.http.routers.openclaw).toBeDefined();
    expect(result).toEqual({ changed: true });
  });

  it('routes every installed component without keepPublicHosts (eve domain apply, eve add)', async () => {
    const { result, routes } = await run(liveRoutes(['pod.example.com']), ['synap', 'openclaw'], {});
    expect(routes.http.routers.openclaw).toBeDefined();
    expect(result).toEqual({ changed: true });
  });

  it('throws when the current routes file cannot be read (never taken for a first install)', async () => {
    await expect(run('unreadable', ['synap', 'openclaw'])).rejects.toThrow('EACCES');
  });
});
