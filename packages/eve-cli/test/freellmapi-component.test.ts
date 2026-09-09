/**
 * FreeLLMAPI component — registry derivation + the unattended key harvest.
 *
 * WHY THESE TWO THINGS:
 *
 * The registry half is the claim that adding one `ComponentInfo` entry buys
 * Traefik routing, health and doctor for free. That claim is only true if the
 * generator actually derives from `COMPONENTS` — so this drives the REAL
 * `TraefikService.configureSubdomains` against a temp dir and reads the routes
 * file it writes, asserting the container/port/subdomain arrive. Asserting the
 * registry entry exists would pass on a component nothing routes to —
 * declaration is not reachability.
 *
 * The key-harvest half is the risky logic. FreeLLMAPI mints its unified key
 * during its FIRST DB migration and prints it to stdout, which is what makes an
 * unattended install possible at all. Getting the scrape wrong doesn't crash —
 * it silently skips provider registration and the operator is told to go read a
 * dashboard. So the parse is tested as a pure seam over real log shapes.
 *
 * NEGATIVE CONTROL RUN (mutation applied, grep-verified in the built dist,
 * reverted): the regex's `{48}` widened to `{8}` — FOUR cases fail, not the one
 * this comment first predicted. The truncated-key case flips as expected, and
 * so do all three positive cases, because a `{8}` match truncates the key it
 * returns. That is a stronger control than the one intended: the length bound
 * is load-bearing for what the parse RETURNS, not merely for what it rejects.
 *
 * NOT COVERED, measured: `docker compose up`, the health poll, and the pod
 * registration call. Those are I/O against a live daemon; this file covers the
 * two pure decisions in front of them.
 */

import { describe, it, expect } from 'vitest';
import { COMPONENTS } from '@eve/dna';
import { parseFreellmapiUnifiedKey, parseFreellmapiSetupCode } from '@eve/dna';

const REAL_KEY = 'freellmapi-' + 'a1b2c3d4'.repeat(6); // 48 hex chars

describe('registry entry', () => {
  const comp = COMPONENTS.find((c) => c.id === 'freellmapi');

  it('is registered', () => {
    expect(comp).toBeDefined();
  });

  it('exposes ONE port for both dashboard and /v1 — not a split', () => {
    // Upstream serves the API and the dashboard on the same port. Splitting
    // them in the registry would route the subdomain at a port nothing listens on.
    expect(comp?.service?.internalPort).toBe(3001);
  });

  it('publishes no host port', () => {
    // Upstream's own compose warns the proxy is "guarded only by the unified
    // API key". Inside Eve it is reached via Traefik, so a host port would only
    // widen exposure.
    expect(comp?.service?.hostPort ?? null).toBeNull();
  });

  it('requires traefik, since it is reached through the proxy', () => {
    expect(comp?.requires).toContain('traefik');
  });
});

describe('traefik routing is DERIVED from the registry', () => {
  /**
   * Drives the REAL generator against a temp config dir and reads the file it
   * writes. Asserting the registry fields directly would be shape, not
   * reachability — it would pass on a component the generator skips.
   *
   * `configureSubdomains` also tries `docker restart eve-legs-traefik`, which
   * is inside its own try/catch and only warns. That is why this needs no
   * docker daemon.
   */
  it('emits a router for freellmapi with no component-specific code', async () => {
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
        'freellmapi',
      ]);

      const routes = readFileSync(j(dir, 'dynamic', 'eve-routes.yml'), 'utf-8');

      // Non-vacuity: the generator produced real routes, not an empty file.
      expect(routes.length).toBeGreaterThan(50);
      // Reachability: this component's real identity arrived in the output.
      expect(routes).toContain('eve-brain-freellmapi');
      expect(routes).toContain('3001');
      expect(routes).toContain('llm.example.test');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('parseFreellmapiUnifiedKey', () => {
  it('finds the key in the first-boot log line', () => {
    const logs = [
      'server listening on 3001',
      '',
      `  Your unified API key: ${REAL_KEY}`,
      '',
    ].join('\n');
    expect(parseFreellmapiUnifiedKey(logs)).toBe(REAL_KEY);
  });

  it('matches the KEY SHAPE, not the sentence around it', () => {
    // A reworded log line must still yield the key — the sentence is upstream's
    // to change, the key format is what the API actually accepts.
    expect(parseFreellmapiUnifiedKey(`api key => ${REAL_KEY} <=`)).toBe(REAL_KEY);
  });

  it('takes the LAST key so a regenerated one wins over the original', () => {
    const second = 'freellmapi-' + 'f0e1d2c3'.repeat(6);
    const logs = `first: ${REAL_KEY}\nregenerated: ${second}`;
    expect(parseFreellmapiUnifiedKey(logs)).toBe(second);
  });

  it('returns null when no key was printed', () => {
    expect(parseFreellmapiUnifiedKey('boot ok\nlistening\n')).toBeNull();
  });

  it('ignores a truncated key rather than registering a broken provider', () => {
    // Half a key authenticates against nothing; registering it would produce a
    // provider that 401s on every call and looks like a gateway outage.
    expect(parseFreellmapiUnifiedKey('freellmapi-a1b2c3d4')).toBeNull();
  });

  it('ignores non-hex noise of the right length', () => {
    expect(parseFreellmapiUnifiedKey('freellmapi-' + 'z'.repeat(48))).toBeNull();
  });
});

describe('parseFreellmapiSetupCode', () => {
  // Upstream logs `  First-run setup code: <10 chars>` at every boot while the
  // dashboard is unclaimed, and clears it once an account exists.
  const CODE = 'ABCDEFGHJK';

  it('reads the code from the real log line', () => {
    const logs = [
      '',
      `  First-run setup code: ${CODE}`,
      '  A browser on this machine can finish setup without it. From any',
      '  other device, enter this code to create the first account.',
      '',
    ].join('\n');
    expect(parseFreellmapiSetupCode(logs)).toBe(CODE);
  });

  it('takes the LAST code — it is regenerated on every restart', () => {
    // The decisive case: an earlier code in the same log is stale and the
    // server would reject it, so returning the first match is a real defect.
    const logs = `First-run setup code: MNPQRSTUVW\nrestart\nFirst-run setup code: ${CODE}`;
    expect(parseFreellmapiSetupCode(logs)).toBe(CODE);
  });

  it('returns null once the dashboard is claimed (no code logged)', () => {
    // Not a fault — the normal steady state.
    expect(parseFreellmapiSetupCode('server listening\nready\n')).toBeNull();
  });

  it('rejects letters upstream excludes from its alphabet', () => {
    // The alphabet omits I, O, 0 and 1 to avoid ambiguity. A regex that
    // accepted them would happily return a code the server cannot match.
    expect(parseFreellmapiSetupCode('First-run setup code: ABCDEFGHIO')).toBeNull();
    expect(parseFreellmapiSetupCode('First-run setup code: ABCDEFGH01')).toBeNull();
  });

  it('rejects a wrong-length code', () => {
    expect(parseFreellmapiSetupCode('First-run setup code: ABCDEFGH')).toBeNull();
  });
});
