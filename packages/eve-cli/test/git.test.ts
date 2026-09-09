/**
 * Tests for the one git door.
 *
 * The load-bearing assertions here are the two that encode real production
 * defects (see lib/git.ts):
 *   • a `could not read Username` failure must NOT be classified as `dirty`,
 *     because `dirty` is the ONE outcome a caller is allowed to build on;
 *   • the non-interactivity floor must actually be applied, so a headless
 *     deploy can never block on a TTY prompt that isn't there.
 */

import { describe, it, expect } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import {
  classifyGitFailure,
  gitEnv,
  HARDENED_ARGS,
  runGit,
  syncRepo,
  toSshRemote,
} from '../src/lib/git.js';

describe('classifyGitFailure', () => {
  it('classifies the deb12u15 libcurl symptom as auth, never as dirty', () => {
    // The exact stderr observed on synap-personal on 2026-09-02. If this ever
    // classifies as `dirty`, `eve synap deploy` silently builds stale code.
    const stderr = [
      "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
      'fatal: expected flush after ref listing',
    ].join('\n');
    expect(classifyGitFailure(stderr)).toBe('auth');
    expect(classifyGitFailure(stderr)).not.toBe('dirty');
  });

  it.each([
    ['Authentication failed for https://github.com/x/y.git', 'auth'],
    ['git@github.com: Permission denied (publickey).', 'auth'],
    ['fatal: could not resolve host: github.com', 'network'],
    ["fatal: 'origin' does not appear to be a git repository", 'no-remote'],
    ['fatal: not a git repository (or any of the parent directories): .git', 'not-a-repo'],
    ['error: Your local changes to the following files would be overwritten by merge', 'dirty'],
    ['CONFLICT (content): Merge conflict in src/a.ts', 'conflict'],
  ] as const)('classifies %j as %s', (stderr, kind) => {
    expect(classifyGitFailure(stderr)).toBe(kind);
  });

  it('falls through to unknown rather than guessing', () => {
    expect(classifyGitFailure('something nobody has seen before')).toBe('unknown');
  });
});

describe('non-interactivity floor', () => {
  it('sets every variable git consults before falling back to a TTY', () => {
    const env = gitEnv();
    // Plugging one hole leaves the others open — assert all of them.
    expect(env.GIT_TERMINAL_PROMPT).toBe('0');
    expect(env.GIT_ASKPASS).toBeTruthy();
    expect(env.SSH_ASKPASS).toBeTruthy();
    expect(env.GCM_INTERACTIVE).toBe('never');
  });

  it('passes credential.interactive=never on every invocation', () => {
    expect(HARDENED_ARGS.join(' ')).toContain('credential.interactive=never');
  });

  it('runGit never throws — it returns a classifiable result', async () => {
    const res = await runGit(['rev-parse', 'HEAD'], { cwd: tmpdir() });
    expect(typeof res.ok).toBe('boolean');
    if (!res.ok) expect(classifyGitFailure(res.stderr)).toBe('not-a-repo');
  });
});

describe('syncRepo', () => {
  let dir: string;

  const mk = async () => {
    dir = await mkdtemp(join(tmpdir(), 'eve-git-test-'));
    return dir;
  };

  it('fails closed on a directory that is not a checkout', async () => {
    const d = await mk();
    try {
      const out = await syncRepo(d);
      expect(out.kind).toBe('failed');
      if (out.kind === 'failed') expect(out.reason).toBe('not-a-repo');
    } finally {
      await rm(d, { recursive: true, force: true });
    }
  });

  it('fails closed on a checkout with no origin — the tarball-fallback state', async () => {
    const d = await mk();
    try {
      await execa('git', ['init', '-q'], { cwd: d });
      await writeFile(join(d, 'f.txt'), 'x');
      const out = await syncRepo(d);
      expect(out.kind).toBe('failed');
      // This is the /opt/synap/* state: 11 checkouts, zero remotes. It must
      // be reported as its own reason, not swallowed as "uncommitted changes".
      if (out.kind === 'failed') expect(out.reason).toBe('no-remote');
    } finally {
      await rm(d, { recursive: true, force: true });
    }
  });

  it('reports dirty ONLY after the remote was actually reached', async () => {
    // A local bare repo stands in for the remote: reachable with no network.
    const remote = await mkdtemp(join(tmpdir(), 'eve-git-remote-'));
    const work = await mkdtemp(join(tmpdir(), 'eve-git-work-'));
    try {
      await execa('git', ['init', '-q', '--bare'], { cwd: remote });
      await execa('git', ['init', '-q', '-b', 'main'], { cwd: work });
      await execa('git', ['config', 'user.email', 't@t.t'], { cwd: work });
      await execa('git', ['config', 'user.name', 't'], { cwd: work });
      await writeFile(join(work, 'f.txt'), 'one');
      await execa('git', ['add', '-A'], { cwd: work });
      await execa('git', ['commit', '-qm', 'init'], { cwd: work });
      await execa('git', ['remote', 'add', 'origin', remote], { cwd: work });
      await execa('git', ['push', '-q', '-u', 'origin', 'main'], { cwd: work });

      const clean = await syncRepo(work);
      expect(clean.kind).toBe('updated');

      await writeFile(join(work, 'f.txt'), 'two');
      const dirty = await syncRepo(work);
      expect(dirty.kind).toBe('dirty');
      if (dirty.kind === 'dirty') expect(dirty.files.length).toBeGreaterThan(0);
    } finally {
      await rm(remote, { recursive: true, force: true });
      await rm(work, { recursive: true, force: true });
    }
  });

  it('fast-forwards and reports the commit it moved to', async () => {
    const remote = await mkdtemp(join(tmpdir(), 'eve-git-remote-'));
    const author = await mkdtemp(join(tmpdir(), 'eve-git-author-'));
    const work = await mkdtemp(join(tmpdir(), 'eve-git-work-'));
    try {
      await execa('git', ['init', '-q', '--bare'], { cwd: remote });
      const cfg = async (d: string) => {
        await execa('git', ['config', 'user.email', 't@t.t'], { cwd: d });
        await execa('git', ['config', 'user.name', 't'], { cwd: d });
      };
      await execa('git', ['init', '-q', '-b', 'main'], { cwd: author });
      await cfg(author);
      await writeFile(join(author, 'f.txt'), 'one');
      await execa('git', ['add', '-A'], { cwd: author });
      await execa('git', ['commit', '-qm', 'one'], { cwd: author });
      await execa('git', ['remote', 'add', 'origin', remote], { cwd: author });
      await execa('git', ['push', '-q', '-u', 'origin', 'main'], { cwd: author });

      await execa('git', ['clone', '-q', remote, work]);
      await cfg(work);

      await writeFile(join(author, 'f.txt'), 'two');
      await execa('git', ['commit', '-qam', 'two'], { cwd: author });
      await execa('git', ['push', '-q'], { cwd: author });

      const out = await syncRepo(work);
      expect(out.kind).toBe('updated');
      if (out.kind === 'updated') expect(out.from).not.toBe(out.to);
    } finally {
      for (const d of [remote, author, work]) await rm(d, { recursive: true, force: true });
    }
  });
});

describe('toSshRemote', () => {
  it('rewrites an https remote to the ssh form the fix message suggests', () => {
    expect(toSshRemote('https://github.com/Synap-core/first-app.git')).toBe(
      'git@github.com:Synap-core/first-app.git',
    );
    // Missing .git suffix is common in hand-edited configs.
    expect(toSshRemote('https://github.com/Synap-core/backend')).toBe(
      'git@github.com:Synap-core/backend.git',
    );
  });

  it('returns null rather than emitting a bogus command for a non-https remote', () => {
    expect(toSshRemote('git@github.com:Synap-core/backend.git')).toBeNull();
    expect(toSshRemote('/opt/some/local/bare.git')).toBeNull();
  });
});
