/**
 * `@eve/dna` pod-provider client.
 *
 * WHAT THESE PIN, and why each one is a defect that already existed:
 *
 *  1. A governed write (HTTP 202 `{status:"proposed"}`) is NOT reported as
 *     success. `eve brain providers add` printed
 *     `✓ Provider "x" saved and synced to IS.` on ANY 2xx. Once provider writes
 *     became governed on the pod, that line would have claimed a provider was
 *     live while nothing had been written — and the operator would then wire
 *     local containers against a provider the pod does not have.
 *  2. `proposed` is detected from the STATUS FIELD as well as the code, so a
 *     pod that returns 200 with `{status:"proposed"}` still reads correctly.
 *     Keying on 202 alone is the brittle half.
 *  3. A 403 naming `providers.write` produces an ACTIONABLE message. The scope
 *     is deliberately outside the default agent bundle, so the honest answer is
 *     "this key was never granted it", not "403".
 *  4. `describePodProviderResult` never describes a proposal with a success
 *     verb — the two commands share one describer precisely so they cannot
 *     drift into describing the same outcome differently.
 *
 * NEGATIVE CONTROLS RUN (mutation applied, grep-verified as landed, reverted):
 *  - `if (res.status === 202 || json.status === "proposed")` → `if (false)`:
 *    exactly the TWO upsert propose tests fail. Not three — the describer test
 *    builds its result value directly, so no change inside `upsertPodProvider`
 *    can reach it. Stated because the first draft of this comment guessed
 *    three and the run disproved it.
 *
 *    Worth recording HOW the mutation was verified, because the obvious check
 *    lied: the client is imported from `@eve/dna`'s BUILT dist, and
 *    `grep MUTANT dist/index.js` returned 0 after a real rebuild — tsup strips
 *    comments, so the marker vanished while the mutation itself was present.
 *    The honest tell was grepping for the mutated CODE (`if (false)` at
 *    dist:3419). A comment marker is not a witness in a bundled package.
 *
 * NOT COVERED, measured: the pod's own decision to propose vs apply. These
 * drive the CLIENT from a stubbed wire response; that an agent key actually
 * gets a proposal is pinned on the pod side in
 * `synap-backend/.../ai-providers.governance.test.ts`.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  upsertPodProvider,
  setPodProviderEnabled,
  describePodProviderResult,
  PodProviderError,
} from '@eve/dna';

const POD = 'https://pod.example.test';
const KEY = 'eve-key';

const BODY = {
  providerId: 'freellmapi',
  name: 'FreeLLMAPI',
  baseUrl: 'http://eve-brain-freellmapi:3001/v1',
};

function stubFetch(status: number, json: unknown) {
  const fn = vi.fn(async () =>
    new Response(JSON.stringify(json), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('upsertPodProvider', () => {
  it('reports an applied write as applied', async () => {
    stubFetch(200, { providerId: 'freellmapi', hasApiKey: true });
    const r = await upsertPodProvider(POD, KEY, BODY);
    expect(r).toEqual({ status: 'applied', providerId: 'freellmapi' });
  });

  it('reports a governed 202 as PROPOSED, never as saved', async () => {
    stubFetch(202, {
      status: 'proposed',
      proposalId: 'prop-42',
      message: 'Provider change filed for approval.',
    });
    const r = await upsertPodProvider(POD, KEY, BODY);

    expect(r.status).toBe('proposed');
    if (r.status !== 'proposed') throw new Error('unreachable');
    expect(r.proposalId).toBe('prop-42');
  });

  it('detects proposed from the status FIELD even on a 200', async () => {
    stubFetch(200, { status: 'proposed', proposalId: 'prop-7' });
    const r = await upsertPodProvider(POD, KEY, BODY);
    expect(r.status).toBe('proposed');
  });

  it('turns a providers.write 403 into an actionable message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('Missing scope: providers.write', { status: 403 })),
    );
    await expect(upsertPodProvider(POD, KEY, BODY)).rejects.toThrow(PodProviderError);
    await expect(upsertPodProvider(POD, KEY, BODY)).rejects.toThrow(/providers\.write/);
    await expect(upsertPodProvider(POD, KEY, BODY)).rejects.toThrow(/scope/i);
  });

  it('names the URL it actually tried on a 404, and does NOT assert a cause', async () => {
    // This test previously pinned the message "running a build older than the
    // provider door" — i.e. it pinned a WRONG CLAIM. A 404 means "nothing at
    // that URL", which is most often the wrong URL, and that misdiagnosis sent
    // a real debugging session after a pod version when the actual fault was
    // an off-host resolver used on-host. The URL is the fact; the cause is not.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
    const err = await upsertPodProvider(POD, KEY, BODY).catch((e) => e as Error);

    expect(err.message).toContain(POD);
    expect(err.message).toContain('/ai-providers');
    expect(err.message).not.toMatch(/older than the provider door/);
  });

  it('sends the key in the body and the bearer in the header', async () => {
    const fn = stubFetch(200, {});
    await upsertPodProvider(POD, KEY, { ...BODY, apiKey: 'secret-1' });

    const [url, init] = fn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${POD}/api/hub/ai-providers`);
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(init.body as string)).toMatchObject({ apiKey: 'secret-1' });
  });
});

describe('setPodProviderEnabled', () => {
  it('hits the enable door and honours a proposal', async () => {
    const fn = stubFetch(202, { status: 'proposed', proposalId: 'p-9' });
    const r = await setPodProviderEnabled(POD, KEY, 'freellmapi', true);

    expect(fn.mock.calls[0]?.[0]).toBe(`${POD}/api/hub/ai-providers/freellmapi/enable`);
    expect(r.status).toBe('proposed');
  });

  it('hits the disable door', async () => {
    const fn = stubFetch(200, {});
    await setPodProviderEnabled(POD, KEY, 'freellmapi', false);
    expect(fn.mock.calls[0]?.[0]).toBe(`${POD}/api/hub/ai-providers/freellmapi/disable`);
  });
});

describe('describePodProviderResult', () => {
  it('does not use a success verb for a proposal', () => {
    const line = describePodProviderResult({
      status: 'proposed',
      providerId: 'freellmapi',
      proposalId: 'prop-42',
      message: 'Filed for approval.',
    });
    expect(line).toMatch(/NOT active yet/);
    expect(line).toContain('prop-42');
    // The exact regression: the old code said "saved and synced".
    expect(line).not.toMatch(/saved/i);
    expect(line).not.toMatch(/synced/i);
  });

  it('does say saved for a real write', () => {
    const line = describePodProviderResult({ status: 'applied', providerId: 'freellmapi' });
    expect(line).toMatch(/saved on the pod/);
  });
});
