/**
 * `provisionAgent` — which extra Hub scopes reach the wire.
 *
 * WHY THIS MATTERS. Writing an `ai_providers` row sets the URL the pod sends
 * every prompt to, so the pod deliberately keeps `providers.write` OUT of the
 * shared agent bundle. `eve` is the operator tool that registers providers on
 * the user's behalf, so it must ask for that scope explicitly — and NOTHING
 * ELSE may ask, or the request would re-widen the default the pod just narrowed
 * and the whole fix would be theatre.
 *
 * These drive the REAL `provisionAgent` through its injected runner seam and
 * assert on the ACTUAL POST body it puts on the wire — not on a constant, and
 * not on a mirrored copy of the decision. Asserting `EVE_EXTRA_SCOPES` directly
 * would pass even if the field were never sent (declaration is not
 * reachability), which is the failure this file exists to prevent.
 *
 * NEGATIVE CONTROL RUN (mutation applied, reverted): the
 * `agentType === EVE_AGENT_TYPE` condition forced to `true` — all FOUR
 * "no other agent asks" cases fail while the eve case still passes, i.e. the
 * per-agent narrowing is load-bearing rather than incidental.
 *
 * How the mutation was confirmed matters here: `grep extraScopes dist/index.js`
 * returned 0 even though the build had run and the behaviour had visibly
 * changed. The bundle is not a reliable witness for a string search. The
 * BEHAVIOURAL result — four specific cases flipping, the fifth not — is what
 * establishes the control landed.
 *
 * NOT COVERED, measured: whether the POD honours or refuses the request. That
 * is the pod's rule, pinned in
 * `synap-backend/.../setup-service.privileged-scopes.test.ts`. Here the claim
 * is only "eve asks, others do not".
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { provisionAgent, renewAgentKey } from '@eve/lifecycle';

/** Captures the request `provisionAgent` actually makes. */
function makeRunner() {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  return {
    calls,
    runner: {
      async httpPost(url: string, _h: unknown, body: string) {
        calls.push({ url, body: JSON.parse(body) as Record<string, unknown> });
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({ apiKey: 'synap_hub_live_x', agentType: 'eve' }),
        };
      },
      async httpGet() {
        return { ok: true, status: 200, body: '{}' };
      },
    } as never,
  };
}

function withSecretsDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'eve-scopes-'));
  mkdirSync(join(dir, '.eve', 'secrets'), { recursive: true });
  writeFileSync(
    join(dir, '.eve', 'secrets', 'secrets.json'),
    JSON.stringify({ version: '1', updatedAt: new Date().toISOString(), synap: { apiUrl: 'https://pod.test' } }),
  );
  return fn(dir).finally(() => rmSync(dir, { recursive: true, force: true }));
}

async function provision(agentType: string) {
  const { calls, runner } = makeRunner();
  await withSecretsDir(async (dir) => {
    await provisionAgent({
      agentType,
      deployDir: dir,
      synapUrl: 'https://pod.test',
      provisioningToken: 'test-token',
      runner,
    });
  });
  return calls;
}

describe('eve asks for providers.write', () => {
  it('puts extraScopes on the wire for the eve agent', async () => {
    const calls = await provision('eve');

    // Non-vacuity: the call actually happened and hit the mint door.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toContain('/api/hub/setup/agent');

    expect(calls[0]?.body.extraScopes).toEqual(['providers.write']);
  });
});

describe('no other agent asks', () => {
  it.each(['claude', 'openclaw', 'openwebui', 'hermes'])(
    'omits extraScopes for %s',
    async (agentType) => {
      const calls = await provision(agentType);

      expect(calls).toHaveLength(1);
      // Absent entirely — not present-and-empty, which an older pod would still
      // read as a request and which would blur "asked for nothing" with
      // "did not ask".
      expect(calls[0]?.body).not.toHaveProperty('extraScopes');
    },
  );
});

describe('linkedUserId reaches the wire', () => {
  /**
   * THE BUG THIS PINS. `--linked-user` was accepted by the CLI, plumbed into
   * `RenewAgentKeyOptions`, and then DROPPED: `renewAgentKey` forwards to
   * `provisionAgent` through a hand-listed field projection that did not
   * include it. Nothing failed — the pod simply kept answering "pass an
   * explicit linkedUserId" to an operator who had passed exactly that.
   *
   * So this asserts on the REQUEST BODY, not on the option being declared.
   * Declaration is not reachability, and a hand-maintained forwarding list is
   * precisely where reachability goes to die.
   */
  it('forwards linkedUserId from renewAgentKey through to the POST body', async () => {
    const { calls, runner } = makeRunner();
    await withSecretsDir(async (dir) => {
      await renewAgentKey({
        agentType: 'eve',
        deployDir: dir,
        provisioningToken: 'test-token',
        runner,
        linkedUserId: 'e418d146-e495-4b8a-8e8b-985f9f885431',
      });
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.body.linkedUserId).toBe('e418d146-e495-4b8a-8e8b-985f9f885431');
  });

  it('omits linkedUserId entirely when not supplied', async () => {
    // A single-human pod must keep working with no flag, and an explicit
    // `undefined` on the wire is not the same as an absent key.
    const { calls, runner } = makeRunner();
    await withSecretsDir(async (dir) => {
      await renewAgentKey({ agentType: 'eve', deployDir: dir, provisioningToken: 't', runner });
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).not.toHaveProperty('linkedUserId');
  });
});
