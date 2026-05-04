import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readAgentKey,
  readEveSecrets,
  writeAgentKey,
  writeEveSecrets,
} from '../src/secrets-contract.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'eve-agent-keys-'));

describe('readAgentKey / writeAgentKey', () => {
  let dir: string;
  beforeEach(() => {
    dir = tmp();
  });
  afterAll(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('returns null when no agent record exists', async () => {
    expect(await readAgentKey('eve', dir)).toBeNull();
  });

  it('round-trips a record under secrets.agents[<slug>]', async () => {
    await writeAgentKey(
      'openclaw',
      {
        hubApiKey: 'hub_test_abc',
        agentUserId: 'user-xyz',
        workspaceId: 'ws-123',
        keyId: 'key-id-1',
      },
      dir,
    );
    const back = await readAgentKey('openclaw', dir);
    expect(back).toMatchObject({
      hubApiKey: 'hub_test_abc',
      agentUserId: 'user-xyz',
      workspaceId: 'ws-123',
      keyId: 'key-id-1',
    });
    // createdAt is auto-stamped on write.
    expect(back?.createdAt).toBeDefined();
  });

  it('mirrors eve agent key into legacy synap.apiKey for back-compat', async () => {
    await writeEveSecrets(
      { synap: { apiUrl: 'http://localhost:4000' } },
      dir,
    );
    await writeAgentKey(
      'eve',
      { hubApiKey: 'eve-key', agentUserId: 'u', workspaceId: 'w' },
      dir,
    );
    const secrets = await readEveSecrets(dir);
    expect(secrets?.synap?.apiKey).toBe('eve-key');
    // pre-existing synap fields are preserved
    expect(secrets?.synap?.apiUrl).toBe('http://localhost:4000');
    expect(secrets?.agents?.['eve']?.hubApiKey).toBe('eve-key');
  });

  it('does NOT mirror non-eve agent keys into synap.apiKey', async () => {
    await writeEveSecrets(
      { synap: { apiUrl: 'http://localhost:4000', apiKey: 'legacy' } },
      dir,
    );
    await writeAgentKey(
      'openclaw',
      { hubApiKey: 'oc-key', agentUserId: 'u', workspaceId: 'w' },
      dir,
    );
    const secrets = await readEveSecrets(dir);
    expect(secrets?.synap?.apiKey).toBe('legacy');
    expect(secrets?.agents?.['openclaw']?.hubApiKey).toBe('oc-key');
  });

  it('preserves other agent records when writing one', async () => {
    await writeAgentKey(
      'eve',
      { hubApiKey: 'eve1', agentUserId: 'u1', workspaceId: 'w1' },
      dir,
    );
    await writeAgentKey(
      'openclaw',
      { hubApiKey: 'oc1', agentUserId: 'u2', workspaceId: 'w2' },
      dir,
    );
    expect((await readAgentKey('eve', dir))?.hubApiKey).toBe('eve1');
    expect((await readAgentKey('openclaw', dir))?.hubApiKey).toBe('oc1');
  });
});
