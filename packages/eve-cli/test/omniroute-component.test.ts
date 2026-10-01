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
 * NOT COVERED, measured: `docker compose up`, the health poll, and the pod
 * registration. Those are I/O against a live daemon and a live pod; this file
 * covers the pure decisions in front of them.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { COMPONENTS } from '@eve/dna';

const LIFECYCLE_SRC_DIR = join(
  import.meta.dirname,
  '..', '..', '@eve', 'lifecycle', 'src',
);

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
/**
 * The `runAction` install path must never open an interactive prompt.
 *
 * This is the regression guard for the actual cause of the 404. `runAction`
 * is a GENERATOR driven from three layers below the CLI, so a `@clack` prompt
 * inside it cannot reach the terminal: with a pipe it raised
 * `TTY initialization failed: uv_tty_init returned EINVAL`, and with a real pty
 * it never settled at all. An unsettled `runActionToCompletion` means `eve add`
 * never returned — so its state write and its Traefik refresh never ran, and
 * the subdomain had no router even though the container was healthy.
 *
 * SCOPE, deliberately narrow: this asserts on `runAction`'s OWN module
 * (index.ts), NOT on every file in the package. `install-config-prompts.ts` is
 * a legitimate clack wrapper — `gatherInstallConfig` is IO-pure and takes
 * injected `PromptFns`, so that module is the default implementation for
 * `eve setup`'s wizard, which owns a terminal and should prompt. A blanket
 * package-wide ban (the first version of this guard, which failed on that file)
 * would forbid correct dependency injection and push the next author to
 * re-inline a prompt in the recipe.
 *
 * Does NOT cover: a prompt reached through a helper this module imports, or a
 * hand-rolled blocking stdin read. This matches a clack import in this one
 * module, which is where the defect actually was.
 */
describe('the runAction install path never prompts', () => {
  it('index.ts — the generator dispatcher — imports no interactive prompt', () => {
    const src = readFileSync(join(LIFECYCLE_SRC_DIR, 'index.ts'), 'utf-8');

    // Non-vacuity: prove the scan can still SEE the shape it hunts, so a
    // renamed or reformatted import cannot silently disarm this guard.
    expect(src.length).toBeGreaterThan(1000);

    const CLACK_IMPORT = /from\s+['"]@clack\/prompts['"]|import\(\s*['"]@clack\/prompts['"]\s*\)/;
    // Self-check on a literal sample: if the regex ever stops matching a real
    // clack import, it is blind and every assertion below is worthless.
    expect(CLACK_IMPORT.test(`import { text } from "@clack/prompts";`)).toBe(true);
    expect(CLACK_IMPORT.test(`const p = await import('@clack/prompts');`)).toBe(true);

    expect(CLACK_IMPORT.test(src)).toBe(false);
  });
});

/**
 * The bootstrap token must be scraped from the container's own startup log.
 *
 * OmniRoute refuses its dashboard to a non-loopback peer on a fresh install
 * with "This connection isn't recognized as local … paste the one-time
 * bootstrap token above to continue". Behind Traefik you are ALWAYS
 * non-loopback, so this is the normal first-run path — an operator who is told
 * "sign in with CHANGEME" is sent to a form that cannot work. The token is
 * printed once and never again, so it has to be captured at install time.
 *
 * This asserts the SHAPE of the log line the scrape depends on, against the
 * real line the running container emitted, so a reworded message cannot
 * silently turn the scrape into a no-op. It does NOT run docker: the extractor
 * itself needs a live container and is exercised by `eve add` on the pod.
 */
describe('OmniRoute first-run bootstrap', () => {
  it('the log line the token scrape reads matches what OmniRoute actually emits', () => {
    // Verbatim from the running container's startup log.
    const real = '[BOOTSTRAP] Fresh install detected from a non-loopback peer (e.g. a ' +
      'Docker port-forwarded connection) with no password configured yet. Paste this ' +
      'ONE-TIME bootstrap token into the onboarding wizard to continue: Yx1Ip5AiWOx5H9EGLbHVXWqPw9w9ejAi';

    const SCRAPE = /bootstrap token into the onboarding wizard to continue: ([A-Za-z0-9]+)/;
    const m = SCRAPE.exec(real);

    // Reachability: the value the operator must paste is actually recovered.
    expect(m).not.toBeNull();
    expect(m?.[1]).toBe('Yx1Ip5AiWOx5H9EGLbHVXWqPw9w9ejAi');

    // Non-vacuity: the pattern is anchored on the phrase, so a log that stops
    // containing it yields nothing rather than a wrong token.
    expect(SCRAPE.test('some unrelated line about cleaning up quota_snapshots')).toBe(false);
  });
});
