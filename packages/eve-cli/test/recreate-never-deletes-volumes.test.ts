import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runRecreate, type RecreateDeps } from '../src/commands/manage/backup-update.js';

// update-door plan P0 (2026-10-04): `eve recreate` used to run
// `compose down --volumes` + `docker system prune -a -f --volumes` by default —
// the 2026-10-02 pod-wipe chain. It must never issue a volume-destroying
// command, and in a Synap deploy dir it must delegate to the synap CLI instead
// of running bare compose (which bypasses the pgdata guard + project pin).

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function fakeDeps() {
  const calls: string[][] = [];
  const synapCalls: { sub: string; args: string[]; repoRoot?: string }[] = [];
  const deps: RecreateDeps = {
    exec: async (cmd, args) => {
      calls.push([cmd, ...args]);
    },
    runSynap: ((sub: string, args: string[] = [], opts: { repoRoot?: string } = {}) => {
      synapCalls.push({ sub, args, repoRoot: opts.repoRoot });
      return { ok: true, exitCode: 0, paths: null, stdout: '', stderr: '' };
    }) as RecreateDeps['runSynap'],
    confirm: async () => true,
    log: () => {},
  };
  return { deps, calls, synapCalls };
}

function destroysVolumes(argv: string[]): boolean {
  const line = argv.join(' ');
  return (
    argv.includes('--volumes') ||
    /\bdown\b.*\s-v(\s|$)/.test(line) ||
    /\bvolume\s+(prune|rm)\b/.test(line)
  );
}

describe('eve recreate', () => {
  it('outside a Synap dir: down + image prune + up, and never a volume-destroying command', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'eve-recreate-'));
    dirs.push(cwd);
    writeFileSync(join(cwd, 'docker-compose.yml'), 'services:\n  web:\n    image: nginx\n');
    const { deps, calls, synapCalls } = fakeDeps();

    expect(await runRecreate({ cwd, prune: true }, deps)).toBe(0);

    expect(calls.length).toBeGreaterThan(0); // non-vacuity: it did run commands
    expect(calls.filter(destroysVolumes)).toEqual([]);
    expect(calls).toContainEqual(['docker', 'compose', 'down', '--remove-orphans']);
    expect(calls).toContainEqual(['docker', 'image', 'prune', '-a', '-f']);
    expect(calls).toContainEqual(['docker', 'compose', 'up', '-d']);
    expect(synapCalls).toEqual([]);
  });

  it('in a Synap deploy dir: backs up, then delegates to `synap reset --full` — no bare compose', async () => {
    const root = mkdtempSync(join(tmpdir(), 'eve-recreate-synap-'));
    dirs.push(root);
    const cwd = join(root, 'deploy');
    mkdirSync(cwd);
    writeFileSync(join(root, 'synap'), '#!/bin/bash\n');
    writeFileSync(join(cwd, 'pgdata-safety.sh'), '#!/bin/sh\n');
    writeFileSync(join(cwd, 'docker-compose.yml'), 'services:\n  backend:\n    image: ghcr.io/synap-core/backend:local\n');
    const { deps, calls, synapCalls } = fakeDeps();

    expect(await runRecreate({ cwd, prune: true }, deps)).toBe(0);

    expect(calls).toEqual([['bash', join(cwd, 'pgdata-safety.sh'), 'backup', 'pre-recreate']]);
    expect(calls.filter(destroysVolumes)).toEqual([]);
    expect(synapCalls).toEqual([{ sub: 'reset', args: ['--full'], repoRoot: root }]);
    expect(synapCalls[0].args).not.toContain('--delete-data');
  });

  it('in a Synap deploy dir without the synap CLI: refuses rather than running bare compose', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'eve-recreate-flat-'));
    dirs.push(cwd);
    writeFileSync(join(cwd, 'docker-compose.yml'), 'services:\n  backend:\n    image: ghcr.io/synap-core/backend:latest\n');
    const { deps, calls, synapCalls } = fakeDeps();

    expect(await runRecreate({ cwd, prune: true }, deps)).toBe(1);
    expect(calls).toEqual([]);
    expect(synapCalls).toEqual([]);
  });

  it('the volume detector itself sees the commands recreate used to run', () => {
    expect(destroysVolumes(['docker', 'compose', 'down', '--volumes', '--remove-orphans'])).toBe(true);
    expect(destroysVolumes(['docker', 'system', 'prune', '-a', '-f', '--volumes'])).toBe(true);
    expect(destroysVolumes(['docker', 'compose', 'down', '-v'])).toBe(true);
    expect(destroysVolumes(['docker', 'volume', 'prune', '-f'])).toBe(true);
    expect(destroysVolumes(['docker', 'compose', 'down', '--remove-orphans'])).toBe(false);
  });
});
