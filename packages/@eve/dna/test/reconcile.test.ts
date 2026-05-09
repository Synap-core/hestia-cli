import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { EveSecrets } from '../src/secrets-contract.js';

const mocks = vi.hoisted(() => ({
  writeHermesEnvFile: vi.fn(),
  findPodDeployDir: vi.fn(),
  restartBackendContainer: vi.fn(),
  wireAllInstalledComponents: vi.fn(),
}));

vi.mock('../src/builder-hub-wiring.js', () => ({
  writeHermesEnvFile: mocks.writeHermesEnvFile,
}));

vi.mock('../src/docker-helpers.js', () => ({
  findPodDeployDir: mocks.findPodDeployDir,
  restartBackendContainer: mocks.restartBackendContainer,
}));

vi.mock('../src/wire-ai.js', () => ({
  AI_CONSUMERS_NEEDING_RECREATE: new Set(['openclaw', 'hermes', 'openwebui']),
  wireAllInstalledComponents: mocks.wireAllInstalledComponents,
}));

const { reconcile } = await import('../src/reconcile.js');

function secrets(partial: Partial<EveSecrets> = {}): EveSecrets {
  return {
    version: '1',
    updatedAt: new Date().toISOString(),
    ...partial,
  } as EveSecrets;
}

describe('reconcile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.writeHermesEnvFile.mockResolvedValue('/tmp/hermes.env');
    mocks.findPodDeployDir.mockReturnValue(null);
    mocks.restartBackendContainer.mockReturnValue(false);
    mocks.wireAllInstalledComponents.mockReturnValue([]);
  });

  it('wires known AI consumers and reports env-bound recreates', async () => {
    mocks.wireAllInstalledComponents.mockReturnValue([
      { id: 'openclaw', outcome: 'ok', summary: 'wired' },
      { id: 'synap', outcome: 'ok', summary: 'wired' },
      { id: 'hermes', outcome: 'failed', summary: 'missing' },
    ]);

    const result = await reconcile(
      secrets({
        ai: {
          wiringStatus: {
            openclaw: { lastApplied: '2026-01-01T00:00:00.000Z', outcome: 'ok' },
            synap: { lastApplied: '2026-01-01T00:00:00.000Z', outcome: 'ok' },
            hermes: { lastApplied: '2026-01-01T00:00:00.000Z', outcome: 'ok' },
          },
        },
      }),
      ['ai'],
    );

    expect(mocks.wireAllInstalledComponents).toHaveBeenCalledWith(
      expect.any(Object),
      ['openclaw', 'synap', 'hermes'],
    );
    expect(result.aiWiring).toHaveLength(3);
    expect(result.containerRecreates).toEqual(['openclaw']);
  });

  it('materializes Hermes env for channel and inference changes without throwing', async () => {
    const result = await reconcile(secrets(), ['channels', 'channelRouting', 'inference']);

    expect(mocks.writeHermesEnvFile).toHaveBeenCalledOnce();
    expect(result.envSync).toBe(true);
  });

  it('marks env sync and backend recreate for domain changes when a deploy dir exists', async () => {
    mocks.findPodDeployDir.mockReturnValue('/opt/synap-backend');
    mocks.restartBackendContainer.mockReturnValue(true);

    const result = await reconcile(secrets(), ['domain']);

    expect(mocks.restartBackendContainer).toHaveBeenCalledWith('/opt/synap-backend');
    expect(result.envSync).toBe(true);
    expect(result.containerRecreates).toEqual(['synap']);
  });

  it('keeps cascades best-effort when downstream materialization fails', async () => {
    mocks.writeHermesEnvFile.mockRejectedValue(new Error('not installed'));

    await expect(reconcile(secrets(), ['channels'])).resolves.toMatchObject({
      envSync: false,
      containerRecreates: [],
    });
  });
});
