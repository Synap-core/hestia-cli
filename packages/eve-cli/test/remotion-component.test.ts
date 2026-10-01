/**
 * Remotion component — registry derivation + mode resolution.
 *
 * Remotion is a component like any other (the point of adding it to `COMPONENTS`
 * rather than a bespoke script), but with one wrinkle OmniRoute does not have: it
 * has TWO modes. Either Eve runs a renderer container on the pod, or the operator
 * points at a renderer that already exists somewhere else. Almost every bug this
 * file guards against is a mode bug — a component that silently picks the wrong
 * branch reads as "installed" and renders nothing.
 *
 * The routing half drives the REAL `TraefikService.configureSubdomains` against a
 * temp dir and reads the file it writes, for the same reason the omniroute test
 * does: a registry entry nothing routes to is a declaration, not a feature.
 *
 * NOT COVERED, measured: `docker compose up`, the `/health` poll against a live
 * daemon, and the actual video render. Those are I/O against a running pod; this
 * file covers the pure decisions in front of them. The renderer service's own
 * HTTP contract is covered by `packages/remotion-renderer/test/contract.test.js`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { COMPONENTS, resolveComponent } from '@eve/dna';
import { TraefikService } from '@eve/legs';
// Not re-exported from the package barrel, so reach for the module directly.
// This is the real schema the installer writes through — parsing a payload
// against it is what proves `builder.remotion` is a live, accepted path.
import { SecretsSchema } from '../../@eve/dna/src/secrets-contract.js';

describe('remotion component — registry entry', () => {
  it('is a normal registry entry, so add/remove/doctor derive for free', () => {
    const comp = resolveComponent('remotion');
    expect(comp.id).toBe('remotion');
    expect(comp.organ).toBe('builder');
    expect(comp.service?.containerName).toBe('eve-builder-remotion');
  });

  it('is NOT published publicly: no host port, no subdomain', () => {
    const comp = resolveComponent('remotion');
    // A render service is an API, not a UI. Publishing it would expose an
    // unauthenticated (by default) render endpoint on the public internet.
    expect(comp.service?.hostPort ?? null).toBeNull();
    expect(comp.subdomain ?? null).toBeNull();
  });

  it('probes /health, which reports ok:false when the project cannot bundle', () => {
    // The health path must be the one that distinguishes "container up" from
    // "container up but broken" — a renderer that cannot list a composition is
    // not healthy, and reporting otherwise is how an install claims success over
    // a broken setup.
    expect(resolveComponent('remotion').service?.healthPath).toBe('/health');
  });

  it('requires traefik, because eve-network addressing depends on it', () => {
    expect(resolveComponent('remotion').requires).toContain('traefik');
  });
});

describe('remotion component — routing is derived, not declared', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eve-remotion-route-'));
  });
  afterEach(() => {
    rmSync(dir, { force: true, recursive: true });
  });

  it('adds no public route — the registry entry must not leak a subdomain', () => {
    const traefik = new TraefikService(dir);
    traefik.configureSubdomains();

    const routes = join(dir, 'dynamic', 'eve-routes.yml');
    let written: string;
    try {
      written = readFileSync(routes, 'utf-8');
    } catch {
      written = '';
    }

    // The reachable-ness assertion: driving the real generator must produce a
    // file that does NOT mention a public host for remotion. If a future edit
    // gave it a subdomain, this is where it would show up first.
    expect(written).not.toMatch(/remotion/i);
  });
});

describe('remotion mode resolution — the config that decides where renders go', () => {
  // These mirror `resolveExternalServiceUrl` in @eve/legs/verify-component.ts.
  // Extracted here as a pure function so the DECISION is testable without a
  // secrets file or a docker daemon; the production function is asserted to
  // agree by the source-parity test below.
  const resolve = (entry?: { mode?: string; url?: string } | null): string | null => {
    if (entry?.mode === 'external' && typeof entry.url === 'string' && entry.url.length > 0) {
      return entry.url.replace(/\/$/, '');
    }
    return null;
  };

  it('defaults to container mode when nothing is configured', () => {
    expect(resolve(undefined)).toBeNull();
    expect(resolve(null)).toBeNull();
    expect(resolve({})).toBeNull();
  });

  it('uses the external URL only for an explicit external mode with a URL', () => {
    expect(resolve({ mode: 'external', url: 'https://render.example.com' })).toBe(
      'https://render.example.com',
    );
  });

  it('falls back to container checks for a half-written external config', () => {
    // `mode: external` with no URL, and a URL with no mode, are both a config
    // mid-write. Falling back to the container checks reports a real problem
    // instead of confidently describing a renderer that was never configured.
    expect(resolve({ mode: 'external' })).toBeNull();
    expect(resolve({ url: 'https://render.example.com' })).toBeNull();
    expect(resolve({ mode: 'container', url: 'https://render.example.com' })).toBeNull();
    expect(resolve({ mode: 'external', url: '' })).toBeNull();
  });

  it('strips a trailing slash so probes do not double up', () => {
    expect(resolve({ mode: 'external', url: 'https://render.example.com/' })).toBe(
      'https://render.example.com',
    );
  });

  it('the production resolver uses this exact rule', () => {
    // Reachability, not shape: assert the shipped file still contains the
    // decision, so the mirror above cannot drift from what runs. Scoped to the
    // one function body by a non-greedy match.
    const src = readFileSync(
      new URL('../../@eve/legs/src/lib/verify-component.ts', import.meta.url),
      'utf-8',
    );
    const body = /async function resolveExternalServiceUrl[\s\S]*?\n}/.exec(src)?.[0];
    expect(body, 'resolveExternalServiceUrl must be findable').toBeTruthy();
    expect(body).toMatch(/mode === 'external'/);
    expect(body).toMatch(/url\.length > 0/);
    expect(body).toMatch(/replace\(\/\\\/\$\/, ''\)/);
  });

  it('declares remotion as the ONLY external-mode service', () => {
    // Adding a row here is a decision, not a coincidence — the table is explicit
    // on purpose. If a second component ever becomes externally-addressable this
    // assertion is the reminder to add it deliberately.
    const src = readFileSync(
      new URL('../../@eve/legs/src/lib/verify-component.ts', import.meta.url),
      'utf-8',
    );
    const table = /const EXTERNAL_SERVICES[\s\S]*?\n};/.exec(src)?.[0];
    expect(table, 'EXTERNAL_SERVICES table must be findable').toBeTruthy();
    const rows = [...table!.matchAll(/^\s{2}(\w+):\s*\{/gm)].map(m => m[1]);
    expect(rows).toContain('remotion');
    expect(rows).toHaveLength(1);
  });
});

describe('remotion — the lifecycle must never prompt', () => {
  const lifecycleSrc = readFileSync(
    new URL('../../@eve/lifecycle/src/index.ts', import.meta.url),
    'utf-8',
  );

  it('has no interactive prompt library imported in lifecycle', () => {
    // The omniroute 404 was caused by exactly this: a clack prompt three layers
    // below the CLI could never settle, so `runActionToCompletion` never returned
    // and the install's state write + route refresh never ran. A prompt here is
    // the same bug waiting to happen.
    expect(lifecycleSrc).not.toMatch(/from '@clack\/prompts'/);
    expect(lifecycleSrc).not.toMatch(/from "inquirer"/);
  });

  it('non-vacuity: this scan can still see a literal prompt import', () => {
    // A scan that matches nothing passes every assertion after it. Prove the
    // regexes above are alive by feeding them a sample that must match.
    const sample = "import { text } from '@clack/prompts';";
    expect(sample).toMatch(/from '@clack\/prompts'/);
    expect('import x from "inquirer";').toMatch(/from "inquirer"/);
  });

  it('takes the mode and URL as install options, not as prompts', () => {
    expect(lifecycleSrc).toMatch(/remotionMode\??:/);
    expect(lifecycleSrc).toMatch(/remotionUrl\??:/);
  });
});

describe('remotion secrets contract — builder.remotion is nested, not top-level', () => {
  it('lives under builder, which writeEveSecrets deep-merges', () => {
    // Load-bearing: writeEveSecrets deep-merges only a FIXED list of sections.
    // A new TOP-LEVEL section would be replaced wholesale on a partial write and
    // silently eat its siblings' config. `builder` is already in that list.
    const src = readFileSync(
      new URL('../../@eve/dna/src/secrets-contract.ts', import.meta.url),
      'utf-8',
    );
    // Assert REACHABILITY, not shape: parse the real schema and write a
    // `builder.remotion` payload through it. A regex over the source text
    // proves only that the word "remotion" appears near "builder" -- it cannot
    // tell a nested key from a comment or a sibling section, and matching the
    // nested braces across `z\n  .object({` formatting proved exactly that
    // (it truncated at remotion's own closing brace).
    // The schema is an ENVELOPE (version + updatedAt are required), so a bare
    // `builder` is rejected for reasons unrelated to remotion -- which is
    // itself the reason the assertion parses rather than regexes.
    const parsed = SecretsSchema.safeParse({
      version: '1',
      updatedAt: '2026-10-01T00:00:00.000Z',
      builder: { remotion: { mode: 'external', url: 'https://render.example.com', apiToken: 't' } },
    });
    expect(parsed.success, JSON.stringify((parsed as any).error?.issues)).toBe(true);
    expect((parsed.data as any).builder.remotion.mode).toBe('external');

    // And a container-mode payload -- the default the install writes.
    const container = SecretsSchema.safeParse({
      version: '1',
      updatedAt: '2026-10-01T00:00:00.000Z',
      builder: { remotion: { mode: 'container' } },
    });
    expect(container.success).toBe(true);

    // And `builder` must actually be DEEP-MERGED, or the nesting buys nothing:
    // a section replaced wholesale on a partial write silently eats its
    // siblings' config. The mechanism is a mergeNested(current.X, partial.X)
    // call per section -- assert BOTH operands, so a one-sided merge (which
    // would drop the other half) fails.
    const builderMerge = /mergeNested\(\s*current\.builder[\s\S]*?partial\.builder[\s\S]*?\)/.exec(src);
    expect(builderMerge, 'builder must be deep-merged on a partial write').toBeTruthy();
  });

  it('non-vacuity: the schema really does reject a bad mode', () => {
    // Proves the parse above is not vacuously succeeding because the schema
    // accepts anything at all.
    expect(
      SecretsSchema.safeParse({
        version: '1',
        updatedAt: '2026-10-01T00:00:00.000Z',
        builder: { remotion: { mode: 'nonsense' } },
      }).success,
    ).toBe(false);
  });

});

describe('remotion lifecycle plan entries', () => {
  const src = readFileSync(
    new URL('../../@eve/lifecycle/src/index.ts', import.meta.url),
    'utf-8',
  );

  it('has an UPDATE_PLAN entry, so `eve update remotion` is not a dead end', () => {
    // freellmapi and omniroute are both missing this and error with "has no
    // automated update path". This is the guard that remotion does not repeat it.
    const plan = /UPDATE_PLAN[\s\S]*?\n};/g;
    const all = [...src.matchAll(plan)].map(m => m[0]).join('\n');
    expect(all).toMatch(/\bremotion\s*:/);
  });

  it('has a removePlanFor entry that does NOT target the operator’s project dir', () => {
    // The project directory is the operator's compositions. `eve remove remotion`
    // must not be a removal target for /opt/remotion.
    const remove = /removePlanFor[\s\S]*?\n}/.exec(src)?.[0] ?? '';
    expect(remove).toMatch(/remotion/);
    const remotionCase = /case ['"]remotion['"][\s\S]*?(?=case |default:)/.exec(remove)?.[0] ?? '';
    expect(remotionCase).not.toContain('/opt/remotion');
  });
});