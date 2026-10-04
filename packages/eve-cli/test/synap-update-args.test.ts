// `eve update synap` and the dashboard lifecycle share ONE argv for
// `synap update` (they used to disagree: `--from-image` vs `[]`), and neither
// refreshes the pod's git checkout any more — update-door plan P4.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { synapUpdateArgs } from '@eve/brain';

const src = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf-8');

describe('synapUpdateArgs', () => {
  it('lets the pod resolve its own channel when no release is named', () => {
    expect(synapUpdateArgs()).toEqual([]);
    expect(synapUpdateArgs('  ')).toEqual([]);
  });
  it('passes an explicit release id or channel through --release', () => {
    expect(synapUpdateArgs('fast')).toEqual(['--release', 'fast']);
    expect(synapUpdateArgs('v1.2.3')).toEqual(['--release', 'v1.2.3']);
  });
});

describe('both update doors delegate the same way', () => {
  const cli = src('../src/commands/manage/backup-update.ts');
  const lifecycle = src('../../@eve/lifecycle/src/index.ts');
  it('eve update synap calls synap update with synapUpdateArgs and no git refresh', () => {
    expect(cli).toMatch(/runSynapCli\('update', synapUpdateArgs\(synapRelease\)/);
    expect(cli).not.toMatch(/refreshGit/);
    expect(cli).not.toMatch(/'--from-image'/);
  });
  it('the lifecycle synap plan uses the same argv and no git refresh / image prune', () => {
    expect(lifecycle).toMatch(/args: synapUpdateArgs\(\)/);
    expect(lifecycle).not.toMatch(/refreshGit/);
    expect(lifecycle).not.toMatch(/ghcr\.io\/synap-core\/backend", "ghcr\.io\/synap-core\/pod-agent"/);
  });
});
