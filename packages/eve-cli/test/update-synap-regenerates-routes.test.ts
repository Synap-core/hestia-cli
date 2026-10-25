/**
 * `eve update synap` — the CLI target, which calls the synap CLI itself rather
 * than going through `runAction('synap', 'update')`:
 *
 *   1. refreshes the Eve compose override BEFORE `synap update` runs, so the
 *      update's `compose up` applies it (override v4 puts minio on
 *      eve-network, which the /synap-storage route needs). It was only ever
 *      written afterwards, by the provisioning preflight, and not at all when
 *      the loopback already answered.
 *   2. regenerates the Traefik routes AFTER a successful update, through the
 *      same door as every other update (`refreshRoutesAfterUpdate`), and shows
 *      its line under the spinner.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { refreshRoutesAfterUpdate } from '@eve/lifecycle';

const order = vi.hoisted(() => [] as string[]);
const synapOk = vi.hoisted(() => ({ value: true }));

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  // getSynapBackendContainer → no container (nothing to reconnect)
  execSync: vi.fn(() => ''),
}));

vi.mock('@eve/lifecycle', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@eve/lifecycle')>()),
  refreshRoutesAfterUpdate: vi.fn(async () => {
    order.push('routes');
    return 'Traefik routes refreshed for example.com';
  }),
  // provisioning is best-effort and out of scope here: backend "not ready"
  runBackendPreflight: vi.fn(async () => {
    throw new Error('backend not ready');
  }),
}));

vi.mock('@eve/dna', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@eve/dna')>()),
  readEveSecrets: vi.fn(async () => ({ domain: { primary: 'example.com' } })),
  ensureSynapLoopbackOverride: vi.fn((dir: string) => {
    order.push(`override ${dir}`);
    return { path: `${dir}/docker-compose.override.yml`, outcome: 'wrote' };
  }),
  entityStateManager: { getInstalledComponents: vi.fn(async () => ['traefik', 'synap']) },
}));

vi.mock('@eve/brain', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@eve/brain')>()),
  runSynapCli: vi.fn((sub: string) => {
    order.push(`synap ${sub}`);
    return { ok: synapOk.value, exitCode: synapOk.value ? 0 : 1, paths: null, stdout: '', stderr: '' };
  }),
}));

vi.mock('@eve/legs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@eve/legs')>()),
  dashboardIsRunning: vi.fn(() => false),
}));

async function synapTarget() {
  const { buildUpdateTargets } = await import('../src/commands/manage/backup-update.js');
  const targets = await buildUpdateTargets('/opt/synap-backend/deploy');
  const synap = targets.find((t) => t.id === 'synap');
  if (!synap) throw new Error('no synap target');
  return synap;
}

describe('eve update synap', () => {
  beforeEach(() => {
    order.length = 0;
    synapOk.value = true;
  });

  it('writes the compose override before the synap update, and regenerates the routes after it', async () => {
    const outcome = await (await synapTarget()).update();

    expect(order).toEqual(['override /opt/synap-backend/deploy', 'synap update', 'routes']);
    expect(outcome?.subLines).toContain('Traefik routes refreshed for example.com');
    // a line that says routes were not regenerated names this update to re-run
    expect(vi.mocked(refreshRoutesAfterUpdate)).toHaveBeenCalledWith('eve update synap');
  });

  it('does not regenerate the routes when the synap update failed', async () => {
    synapOk.value = false;

    await expect((await synapTarget()).update()).rejects.toThrow('synap update exited 1');
    expect(order).not.toContain('routes');
  });
});
