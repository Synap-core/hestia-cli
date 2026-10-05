/**
 * `eve remove remotion` (the retired-renderer cleanup path): a docker failure
 * printed "Remotion removal failed" and still exited 0, so a script or the
 * update engine read a failed cleanup as success.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('execa', () => ({
  execa: vi.fn(async () => {
    throw new Error('Cannot connect to the Docker daemon');
  }),
}));
vi.mock('@clack/prompts', () => ({ confirm: vi.fn(), isCancel: vi.fn() }));
vi.mock('@eve/cli-kit', () => ({ getGlobalCliFlags: () => ({}) }));
vi.mock('@eve/dna', () => ({
  entityStateManager: {
    updateComponentEntry: vi.fn(),
    getInstalledComponents: vi.fn(async () => []),
    updateSetupProfile: vi.fn(),
  },
  readSynapEnvValue: vi.fn(),
}));
vi.mock('@eve/legs', () => ({ uninstallDashboardContainer: vi.fn() }));
vi.mock('@eve/lifecycle', () => ({ materializeTargets: vi.fn() }));
vi.mock('../src/lib/ui.js', () => {
  const spinner = { start: vi.fn(), succeed: vi.fn(), fail: vi.fn() };
  const noop = vi.fn();
  return {
    colors: new Proxy({}, { get: () => (s: string) => s }),
    emojis: new Proxy({}, { get: () => '' }),
    printHeader: noop,
    printSuccess: noop,
    printError: noop,
    printInfo: noop,
    printWarning: noop,
    createSpinner: () => spinner,
  };
});

import { runRemove } from '../src/commands/remove.js';

afterEach(() => {
  process.exitCode = undefined;
});

describe('eve remove remotion — exit code', () => {
  it('a docker failure exits non-zero', async () => {
    await runRemove('remotion');
    expect(process.exitCode).toBe(1);
  });
});
