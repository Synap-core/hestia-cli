/**
 * Tests for the agent-key provisioning flow.
 *
 * `provisionAgent` is the canonical mint path used by install, renew,
 * and migrate-legacy. We exercise it with:
 *  - a stub runner (no real HTTP) so the test runs offline
 *  - a per-test EVE_HOME tmpdir so secrets writes don't collide
 *
 * What we cover:
 *  - happy path: pod returns 200 → record persisted under
 *    secrets.agents[<slug>] AND legacy synap.apiKey is mirrored when
 *    the slug is "eve"
 *  - error envelopes: missing pod URL, missing PROVISIONING_TOKEN,
 *    401, 5xx, malformed JSON — every one is surfaced as
 *    {provisioned:false} with a human reason, never throws
 *  - provisionAllAgents skips agents whose backing component isn't
 *    installed but always provisions "eve" (alwaysProvision flag)
 *  - migrateLegacyToAgents is a no-op once secrets.agents.eve exists
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  provisionAgent,
  provisionAllAgents,
  migrateLegacyToAgents,
  type ProvisionResult,
} from '@eve/lifecycle';
import {
  readAgentKey,
  readEveSecrets,
  writeEveSecrets,
} from '@eve/dna';
import type {
  IDoctorRunner,
  DoctorRunnerResponse,
  DoctorRunnerStream,
} from '@eve/lifecycle';

// ---------------------------------------------------------------------------
// Stub runner — replays a sequence of canned responses.
// ---------------------------------------------------------------------------

function makeRunner(reply: () => DoctorRunnerResponse): IDoctorRunner {
  return {
    name: 'stub',
    async httpGet(): Promise<DoctorRunnerResponse> {
      return reply();
    },
    async httpPost(): Promise<DoctorRunnerResponse> {
      return reply();
    },
    async httpDelete(): Promise<DoctorRunnerResponse> {
      return reply();
    },
    async httpStream(): Promise<DoctorRunnerStream> {
      const r = reply();
      return {
        ok: r.status >= 200 && r.status < 300,
        status: r.status,
        headers: r.headers,
        close: async () => { /* no-op */ },
        error: r.error,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Per-test cwd + env shielding
// ---------------------------------------------------------------------------

let dir: string;
let savedEnv: { evt?: string; pt?: string; sd?: string };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'eve-provision-'));
  // Snapshot env so we can deterministically clear it. The auth module
  // resolves PROVISIONING_TOKEN from EVE_PROVISIONING_TOKEN /
  // PROVISIONING_TOKEN / SYNAP_DEPLOY_DIR/.env in that order — we
  // unset the env vars per-test to control which path runs.
  savedEnv = {
    evt: process.env.EVE_PROVISIONING_TOKEN,
    pt: process.env.PROVISIONING_TOKEN,
    sd: process.env.SYNAP_DEPLOY_DIR,
  };
  delete process.env.EVE_PROVISIONING_TOKEN;
  delete process.env.PROVISIONING_TOKEN;
  delete process.env.SYNAP_DEPLOY_DIR;
});

afterEach(() => {
  if (savedEnv.evt) process.env.EVE_PROVISIONING_TOKEN = savedEnv.evt;
  if (savedEnv.pt) process.env.PROVISIONING_TOKEN = savedEnv.pt;
  if (savedEnv.sd) process.env.SYNAP_DEPLOY_DIR = savedEnv.sd;
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

// Build a `synap-backend/deploy/.env` so the resolver can find the token
// without requiring the test to set it via env. Mirrors the real layout.
function seedDeployEnv(token: string): string {
  const deployDir = join(dir, 'fake-deploy');
  mkdirSync(deployDir, { recursive: true });
  writeFileSync(join(deployDir, '.env'), `PROVISIONING_TOKEN=${token}\n`, { mode: 0o600 });
  process.env.SYNAP_DEPLOY_DIR = deployDir;
  return deployDir;
}

// ---------------------------------------------------------------------------
// provisionAgent — happy path
// ---------------------------------------------------------------------------

describe('provisionAgent — happy path', () => {
  it('writes the record under secrets.agents[<slug>]', async () => {
    await writeEveSecrets({ synap: { apiUrl: 'http://localhost:4000' } }, dir);
    seedDeployEnv('test-token');

    const result = await provisionAgent({
      agentType: 'openclaw',
      deployDir: dir,
      runner: makeRunner(() => ({
        status: 200,
        body: JSON.stringify({
          hubApiKey: 'oc-key-abc',
          agentUserId: 'agent-user-1',
          workspaceId: 'ws-1',
          keyId: 'key-1',
        }),
        headers: {},
      })),
    });

    expect(result.provisioned).toBe(true);
    if (!result.provisioned) throw new Error('unreachable');
    expect(result.agentType).toBe('openclaw');
    expect(result.keyIdPrefix).toBe('key-1'.slice(0, 8));

    const persisted = await readAgentKey('openclaw', dir);
    expect(persisted?.hubApiKey).toBe('oc-key-abc');
    expect(persisted?.agentUserId).toBe('agent-user-1');
    expect(persisted?.workspaceId).toBe('ws-1');
  });

  it('mirrors eve agent key into legacy synap.apiKey', async () => {
    await writeEveSecrets({ synap: { apiUrl: 'http://localhost:4000' } }, dir);
    seedDeployEnv('test-token');

    await provisionAgent({
      agentType: 'eve',
      deployDir: dir,
      runner: makeRunner(() => ({
        status: 200,
        body: JSON.stringify({
          hubApiKey: 'eve-key-xyz',
          agentUserId: 'eve-user',
          workspaceId: 'ws-eve',
        }),
        headers: {},
      })),
    });

    const secrets = await readEveSecrets(dir);
    expect(secrets?.synap?.apiKey).toBe('eve-key-xyz');
    expect(secrets?.agents?.['eve']?.hubApiKey).toBe('eve-key-xyz');
  });
});

// ---------------------------------------------------------------------------
// provisionAgent — error envelopes
// ---------------------------------------------------------------------------

describe('provisionAgent — error envelopes', () => {
  it('returns reason when synap.apiUrl is missing', async () => {
    seedDeployEnv('test-token');
    const result = await provisionAgent({
      agentType: 'eve',
      deployDir: dir,
      runner: makeRunner(() => ({ status: 200, body: '{}', headers: {} })),
    });
    expect(result.provisioned).toBe(false);
    if (result.provisioned) throw new Error('unreachable');
    expect(result.reason).toMatch(/synap\.apiUrl not set/);
  });

  it('returns reason when PROVISIONING_TOKEN is unavailable', async () => {
    await writeEveSecrets({ synap: { apiUrl: 'http://localhost:4000' } }, dir);
    // No env var, no deploy/.env — token cannot be resolved.
    const result = await provisionAgent({
      agentType: 'eve',
      deployDir: dir,
      runner: makeRunner(() => ({ status: 200, body: '{}', headers: {} })),
    });
    expect(result.provisioned).toBe(false);
    if (result.provisioned) throw new Error('unreachable');
    expect(result.reason).toMatch(/PROVISIONING_TOKEN unavailable/);
  });

  it('surfaces 401 from the pod with a recognizable message', async () => {
    await writeEveSecrets({ synap: { apiUrl: 'http://localhost:4000' } }, dir);
    seedDeployEnv('bogus');
    const result = await provisionAgent({
      agentType: 'eve',
      deployDir: dir,
      runner: makeRunner(() => ({
        status: 401,
        body: '{"error":"Invalid credentials"}',
        headers: {},
      })),
    });
    expect(result.provisioned).toBe(false);
    if (result.provisioned) throw new Error('unreachable');
    expect(result.reason).toMatch(/PROVISIONING_TOKEN rejected/);
  });

  it('surfaces 5xx as a backend error', async () => {
    await writeEveSecrets({ synap: { apiUrl: 'http://localhost:4000' } }, dir);
    seedDeployEnv('test-token');
    const result = await provisionAgent({
      agentType: 'eve',
      deployDir: dir,
      runner: makeRunner(() => ({
        status: 503,
        body: 'service unavailable',
        headers: {},
      })),
    });
    expect(result.provisioned).toBe(false);
    if (result.provisioned) throw new Error('unreachable');
    expect(result.reason).toMatch(/Backend returned 503/);
  });

  it('surfaces non-JSON success bodies as a parse failure', async () => {
    await writeEveSecrets({ synap: { apiUrl: 'http://localhost:4000' } }, dir);
    seedDeployEnv('test-token');
    const result = await provisionAgent({
      agentType: 'eve',
      deployDir: dir,
      runner: makeRunner(() => ({
        status: 200,
        body: '<html>oops</html>',
        headers: {},
      })),
    });
    expect(result.provisioned).toBe(false);
    if (result.provisioned) throw new Error('unreachable');
    expect(result.reason).toMatch(/not JSON/);
  });

  it('returns reason when agentType is empty', async () => {
    const result = await provisionAgent({
      agentType: '',
      deployDir: dir,
      runner: makeRunner(() => ({ status: 200, body: '{}', headers: {} })),
    });
    expect(result.provisioned).toBe(false);
    if (result.provisioned) throw new Error('unreachable');
    expect(result.reason).toMatch(/agentType is required/);
  });
});

// ---------------------------------------------------------------------------
// provisionAllAgents
// ---------------------------------------------------------------------------

describe('provisionAllAgents', () => {
  it('mints only eve when no add-on components are installed', async () => {
    await writeEveSecrets({ synap: { apiUrl: 'http://localhost:4000' } }, dir);
    seedDeployEnv('test-token');

    const results: ProvisionResult[] = await provisionAllAgents({
      installedComponentIds: [],
      deployDir: dir,
      runner: makeRunner(() => ({
        status: 200,
        body: JSON.stringify({
          hubApiKey: 'eve-key',
          agentUserId: 'u',
          workspaceId: 'w',
        }),
        headers: {},
      })),
    });

    expect(results).toHaveLength(1);
    expect(results[0].agentType).toBe('eve');
    expect(results[0].provisioned).toBe(true);
  });

  it('mints eve + every installed-component agent', async () => {
    await writeEveSecrets({ synap: { apiUrl: 'http://localhost:4000' } }, dir);
    seedDeployEnv('test-token');

    let calls = 0;
    const results = await provisionAllAgents({
      installedComponentIds: ['openclaw', 'openwebui-pipelines'],
      deployDir: dir,
      runner: makeRunner(() => {
        calls += 1;
        return {
          status: 200,
          body: JSON.stringify({
            hubApiKey: `key-${calls}`,
            agentUserId: `user-${calls}`,
            workspaceId: `ws-${calls}`,
          }),
          headers: {},
        };
      }),
    });

    const slugs = results.map((r) => r.agentType);
    expect(slugs).toContain('eve');
    expect(slugs).toContain('openclaw');
    expect(slugs).toContain('openwebui-pipelines');
    expect(slugs).not.toContain('hermes');
    expect(results.every((r) => r.provisioned)).toBe(true);
  });

  it('skips agents whose key already exists when skipIfPresent=true', async () => {
    await writeEveSecrets({ synap: { apiUrl: 'http://localhost:4000' } }, dir);
    seedDeployEnv('test-token');

    // Pre-seed an eve key — provisionAllAgents should leave it alone.
    await writeEveSecrets(
      {
        agents: {
          eve: {
            hubApiKey: 'pre-existing',
            agentUserId: 'u-pre',
            workspaceId: 'w-pre',
          },
        },
      },
      dir,
    );

    let calls = 0;
    await provisionAllAgents({
      installedComponentIds: [],
      deployDir: dir,
      runner: makeRunner(() => {
        calls += 1;
        return {
          status: 200,
          body: JSON.stringify({
            hubApiKey: 'fresh',
            agentUserId: 'u',
            workspaceId: 'w',
          }),
          headers: {},
        };
      }),
      skipIfPresent: true,
    });

    expect(calls).toBe(0);
    const persisted = await readAgentKey('eve', dir);
    expect(persisted?.hubApiKey).toBe('pre-existing');
  });
});

// ---------------------------------------------------------------------------
// migrateLegacyToAgents
// ---------------------------------------------------------------------------

describe('migrateLegacyToAgents', () => {
  it('is a no-op when secrets.agents.eve already exists', async () => {
    await writeEveSecrets(
      {
        synap: { apiUrl: 'http://localhost:4000', apiKey: 'legacy' },
        agents: {
          eve: {
            hubApiKey: 'already',
            agentUserId: 'u',
            workspaceId: 'w',
          },
        },
      },
      dir,
    );
    seedDeployEnv('test-token');

    let calls = 0;
    const result = await migrateLegacyToAgents({
      installedComponentIds: ['openclaw'],
      deployDir: dir,
      runner: makeRunner(() => {
        calls += 1;
        return { status: 200, body: '{}', headers: {} };
      }),
    });

    expect(result.migrated).toBe(false);
    expect(calls).toBe(0);
  });

  it('mints a fresh eve key when only legacy synap.apiKey exists', async () => {
    await writeEveSecrets(
      { synap: { apiUrl: 'http://localhost:4000', apiKey: 'legacy-key' } },
      dir,
    );
    seedDeployEnv('test-token');

    let calls = 0;
    const result = await migrateLegacyToAgents({
      installedComponentIds: [],
      deployDir: dir,
      runner: makeRunner(() => {
        calls += 1;
        return {
          status: 200,
          body: JSON.stringify({
            hubApiKey: 'eve-fresh',
            agentUserId: 'u',
            workspaceId: 'w',
          }),
          headers: {},
        };
      }),
    });

    expect(result.migrated).toBe(true);
    expect(calls).toBe(1); // only eve agent (no add-ons installed)
    const persisted = await readAgentKey('eve', dir);
    expect(persisted?.hubApiKey).toBe('eve-fresh');
    // Legacy mirror updated to the new value.
    const secrets = await readEveSecrets(dir);
    expect(secrets?.synap?.apiKey).toBe('eve-fresh');
  });
});
