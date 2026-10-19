/**
 * Postiz component — registry derivation, compose shape, env rendering.
 *
 * Postiz is a NORMAL component: one `ComponentInfo` entry buys Traefik routing,
 * doctor and `eve add/remove/update`. The routing half drives the REAL
 * `TraefikService.configureSubdomains` and reads the file it writes, because a
 * registry entry nothing routes to would pass a declaration check.
 *
 * The compose half parses the generated YAML and checks the isolation the
 * design depends on: only the app joins eve-network, nothing publishes a host
 * port, every image is pinned, every container and volume is Eve-named, and
 * every container hostname the app is told to dial is a container in the file.
 *
 * NOT COVERED, measured: `docker compose up`, the health wait and the pod
 * apply. Those need a daemon and a live pod; `docker compose config` accepted
 * the rendered file offline when this was written, which is as far as a test
 * without a daemon can go. The pod's SSRF guard is backend code and is not
 * imported here.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { COMPONENTS } from '@eve/dna';
import {
  POSTIZ_COMPOSE_YAML,
  POSTIZ_VERSION,
  postizInternalApiUrl,
  renderPostizEnv,
} from '@eve/lifecycle';

// js-yaml is a dependency of @eve/dna, not of this package: resolve it from
// there rather than adding a dependency for one test.
const requireFromDna = createRequire(
  join(import.meta.dirname, '..', '..', '@eve', 'dna', 'package.json'),
);
const yaml = requireFromDna('js-yaml') as { load: (s: string) => unknown };

interface ComposeService {
  image: string;
  container_name: string;
  networks?: string[];
  ports?: unknown;
}
interface ComposeFile {
  services: Record<string, ComposeService>;
  networks: Record<string, { external?: boolean; name?: string }>;
  volumes: Record<string, { name?: string }>;
}

const compose = yaml.load(POSTIZ_COMPOSE_YAML) as ComposeFile;
const services = Object.entries(compose.services);

describe('registry entry', () => {
  const comp = COMPONENTS.find((c) => c.id === 'postiz');

  it('is registered under the id `eve add postiz` uses, as an arms organ', () => {
    expect(comp).toBeDefined();
    expect(comp?.organ).toBe('arms');
  });

  it('routes to the app container on the image Caddy port, with no host port', () => {
    expect(comp?.service?.containerName).toBe('eve-arms-postiz');
    expect(comp?.service?.internalPort).toBe(5000);
    expect(comp?.service?.hostPort ?? null).toBeNull();
    expect(comp?.service?.subdomain).toBe('postiz');
  });

  it('requires traefik (its URL) and synap (the pod it registers with)', () => {
    expect(comp?.requires).toEqual(expect.arrayContaining(['traefik', 'synap']));
  });
});

describe('traefik routing is DERIVED from the registry', () => {
  it('emits a router for postiz with no component-specific code', async () => {
    const { TraefikService } = await import('@eve/legs');
    const { mkdtempSync, readFileSync, mkdirSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');

    const dir = mkdtempSync(join(tmpdir(), 'eve-traefik-'));
    mkdirSync(join(dir, 'dynamic'), { recursive: true });
    try {
      const svc = new TraefikService(dir);
      await svc.configureSubdomains('example.test', false, undefined, ['traefik', 'postiz']);
      const routes = readFileSync(join(dir, 'dynamic', 'eve-routes.yml'), 'utf-8');

      expect(routes.length).toBeGreaterThan(50); // non-vacuity
      expect(routes).toContain('eve-arms-postiz:5000');
      expect(routes).toContain('postiz.example.test');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('compose file', () => {
  it('parses into the app plus its databases and Temporal stack', () => {
    // Non-vacuity for every per-service loop below.
    expect(services.length).toBe(6);
    expect(compose.services.postiz).toBeDefined();
  });

  it('names every container eve-arms-postiz*', () => {
    for (const [, s] of services) expect(s.container_name).toMatch(/^eve-arms-postiz(-[a-z]+)*$/);
  });

  it('puts ONLY the app on eve-network; everything else stays on the private network', () => {
    expect(compose.networks['eve-network']?.external).toBe(true);
    const onEve = services.filter(([, s]) => (s.networks ?? []).includes('eve-network')).map(([k]) => k);
    expect(onEve).toEqual(['postiz']);
    for (const [, s] of services) expect(s.networks).toContain('postiz-internal');
    expect(compose.networks['postiz-internal']?.external).toBeFalsy();
  });

  it('publishes no host port', () => {
    expect(services.filter(([, s]) => s.ports !== undefined).map(([k]) => k)).toEqual([]);
  });

  it('pins every image; the app to POSTIZ_VERSION', () => {
    for (const [, s] of services) {
      expect(s.image).toMatch(/:[^:/]+$/);
      expect(s.image).not.toMatch(/:latest$/);
    }
    expect(compose.services.postiz.image).toBe(`ghcr.io/gitroomhq/postiz-app:${POSTIZ_VERSION}`);
  });

  it('names every volume eve-postiz-* (what eve backup lists)', () => {
    const vols = Object.values(compose.volumes);
    expect(vols.length).toBe(6);
    for (const v of vols) expect(v.name).toMatch(/^eve-postiz-/);
  });

  it('every container hostname the stack dials is a container in this file', () => {
    const declared = new Set(services.map(([, s]) => s.container_name));
    const dialled = new Set(POSTIZ_COMPOSE_YAML.match(/eve-arms-postiz(?:-[a-z]+)*(?=[:\s"]|$)/gm) ?? []);
    // Non-vacuity: the database, redis and temporal addresses are all in there.
    expect(dialled.size).toBeGreaterThanOrEqual(5);
    for (const host of dialled) expect(declared).toContain(host);
  });

  it('carries no secret: every secret is substituted from .env', () => {
    expect(POSTIZ_COMPOSE_YAML).toContain('${POSTIZ_JWT_SECRET:?');
    expect(POSTIZ_COMPOSE_YAML).toContain('${POSTIZ_DB_PASSWORD:?');
    expect(POSTIZ_COMPOSE_YAML).toContain('${POSTIZ_TEMPORAL_DB_PASSWORD:?');
  });
});

describe('the URL the pod is given', () => {
  it('is the app container on eve-network, under /api', () => {
    const url = new URL(postizInternalApiUrl());
    expect(url.toString()).toBe('http://eve-arms-postiz:5000/api');
    // Reachability: the host is the one container that joins eve-network.
    expect(url.hostname).toBe(compose.services.postiz.container_name);
    expect(compose.services.postiz.networks).toContain('eve-network');
  });
});

describe('renderPostizEnv', () => {
  const secrets = { jwtSecret: 'j', dbPassword: 'd', temporalDbPassword: 't' };

  it('derives the public URLs from the current domain', () => {
    const env = renderPostizEnv('example.test', true, secrets);
    expect(env).toContain('POSTIZ_MAIN_URL=https://postiz.example.test\n');
    expect(env).toContain('POSTIZ_BACKEND_URL=https://postiz.example.test/api\n');
    expect(env).toContain('POSTIZ_DB_PASSWORD=d\n');
  });

  it('omits NOT_SECURED on HTTPS (Postiz reads it by truthiness) and sets it on HTTP', () => {
    expect(renderPostizEnv('example.test', true, secrets)).not.toContain('NOT_SECURED');
    const http = renderPostizEnv('example.test', false, secrets);
    expect(http).toContain('POSTIZ_MAIN_URL=http://postiz.example.test\n');
    expect(http).toContain('POSTIZ_NOT_SECURED=true\n');
  });

  it('refuses to render without a public domain', () => {
    expect(() => renderPostizEnv(undefined, true, secrets)).toThrow(/eve domain set/);
    expect(() => renderPostizEnv('localhost', false, secrets)).toThrow(/eve domain set/);
  });
});
