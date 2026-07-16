import { describe, expect, it } from 'vitest';
import { normalizeSynapManagedUpdateTargets } from '../src/commands/manage/backup-update.js';

describe('Synap-managed update targets', () => {
  it('maps Pod Admin to the one canonical Synap update', () => {
    const targets = new Set(['synap', 'pod-admin']);

    expect(normalizeSynapManagedUpdateTargets(targets)).toBe(true);
    expect(targets).toEqual(new Set(['synap']));
  });

  it('leaves independent component updates unchanged', () => {
    const targets = new Set(['openwebui']);

    expect(normalizeSynapManagedUpdateTargets(targets)).toBe(false);
    expect(targets).toEqual(new Set(['openwebui']));
  });
});
