/**
 * OmniRoute component — registry derivation.
 *
 * The point of the refactor is that OmniRoute is a NORMAL component: adding one
 * `ComponentInfo` entry buys Traefik routing, doctor and `eve add/remove/update`
 * for free, with no provider-specific code. That claim is only true if the
 * generators actually derive from `COMPONENTS` — so the routing half below
 * drives the REAL `TraefikService.configureSubdomains` against a temp dir and
 * reads the file it writes. Asserting the registry entry exists would pass on a
 * component nothing routes to: declaration is not reachability.
 *
 * This is the regression guard for the thing that went wrong before: OmniRoute
 * shipped as a standalone `eve setup-omniroute` script with its own inline
 * `docker run`, so it had NO registry entry, NO route, and NO doctor check —
 * which is why reaching its dashboard required asking for a container IP.
 *
 * The port here is 20128, taken from the RUNNING container (its Next.js server
 * reports `- Network: http://0.0.0.0:20128`), not from the image's README: the
 * README's "keyless" line describes the npm package, and the docker image
 * authenticates (AUTH_002). Both were wrong assumptions that cost a debugging
 * cycle each, so both are pinned here rather than left to a comment.
 *
 * NOT COVERED, measured: `docker compose up`, the health poll, the key prompt,
 * and the pod registration. Those are I/O against a live daemon and a live pod;
 * this file covers the pure decisions in front of them.
 */

import { describe, it, expect } from 'vitest';
import { COMPONENTS } from '@eve/dna';

describe('registry entry', () => {
  const comp = COMPONENTS.find((c) => c.id === 'omniroute');

  it('is registered as a brain organ', () => {
    // Declaration alone is not the claim — the routing half below is. This
    // just pins that the entry exists under the id `eve add omniroute` uses.
    expect(comp).toBeDefined();
    expect(comp?.organ).toBe('brain');
  });

  it('exposes the port the container actually serves on', () => {
    // 20128 from the running container's own startup line. NOT 3000: that was
    // the original guess and it collided with the dashboard/openclaw/dokploy
    // stack — and the image never listened there in the first place.
    expect(comp?.service?.internalPort).toBe(20128);
  });

  it('publishes no host port', () => {
    // Reached by container name on eve-network (that is the IS's route) and by
    // subdomain for humans. A host binding would only widen exposure.
    expect(comp?.service?.hostPort ?? null).toBeNull();
  });

  it('requires traefik, since it is reached through the proxy', () => {
    expect(comp?.requires).toContain('traefik');
  });

  it('is NOT health-checked over HTTP', () => {
    // OmniRoute returns AUTH_002 on /v1/models without a key. An http health
    // probe would therefore read a healthy, correctly-authenticated gateway as
    // DOWN, and `eve doctor` would cry wolf on a working install.
    expect(comp?.health?.kind).toBe('docker');
  });
});

describe('traefik routing is DERIVED from the registry', () => {
  it('emits a router for omniroute with no component-specific code', async () => {
    const { TraefikService } = await import('@eve/legs');
    const { mkdtempSync, readFileSync, mkdirSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join: j } = await import('node:path');

    const dir = mkdtempSync(j(tmpdir(), 'eve-traefik-'));
    mkdirSync(j(dir, 'dynamic'), { recursive: true });
    try {
      const svc = new TraefikService(dir);
      await svc.configureSubdomains('example.test', false, undefined, [
        'traefik',
        'omniroute',
      ]);

      const routes = readFileSync(j(dir, 'dynamic', 'eve-routes.yml'), 'utf-8');

      // Non-vacuity: the generator produced real routes, not an empty file.
      expect(routes.length).toBeGreaterThan(50);
      // Reachability: this component's real identity arrived in the output.
      expect(routes).toContain('eve-brain-omniroute');
      expect(routes).toContain('20128');
      expect(routes).toContain('omniroute.example.test');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});