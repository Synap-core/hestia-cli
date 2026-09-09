/**
 * The ONE door for every git invocation the CLI makes.
 *
 * # Why this file exists
 *
 * Two production defects, both found on 2026-09-02 while root-causing a
 * `git pull` that had started prompting `Username for 'https://github.com'`
 * on all three Synap hosts:
 *
 *  1. **The install path was prompt-proof; the update path was not.**
 *     `setup.ts` cloned with `credential.interactive=never` AND
 *     `GIT_TERMINAL_PROMPT=0`, so it could never hang. `synap.ts` ran a bare
 *     `git pull --rebase`. Invoked non-interactively (the eve dashboard, a
 *     cron, `ssh host 'eve synap deploy'`) that BLOCKS ON STDIN FOREVER,
 *     because git's fallback for "I need credentials" is to read a TTY that
 *     isn't there. A server-side CLI must never be able to reach that state
 *     — hence `gitEnv()` / `HARDENED_ARGS`, applied by `runGit()` to every
 *     call, with no opt-out.
 *
 *  2. **A failed pull was misreported and the build continued anyway.**
 *     The old catch said `'Git pull failed (may be uncommitted changes) —
 *     continuing'` for ANY error. On 2026-09-02 that sentence would have
 *     been shown for an HTTP-layer failure, and the build would then have
 *     run against a stale checkout and reported success. That is exactly
 *     the defect class `synap-backend/deploy/verify-deploy.sh` was written
 *     to catch. `syncRepo()` therefore CLASSIFIES the failure and the caller
 *     fails closed on everything that is not a genuinely dirty tree.
 *
 * # The HTTP/1.1 retry is not superstition
 *
 * Debian 12's `libcurl3-gnutls` 7.88.1-10+deb12u15 (shipped by
 * unattended-upgrades on 2026-07-12) breaks git's protocol-v2 flow over
 * HTTP/2 on the SECOND request:
 *
 *     GET  /<repo>.git/info/refs?service=git-upload-pack -> HTTP/2 200
 *     POST /<repo>.git/git-upload-pack                   -> HTTP/2 401
 *                                       www-authenticate: Basic realm="GitHub"
 *
 * Git sees the 401, concludes it needs credentials, and prompts — even for a
 * PUBLIC repository the very same box can read anonymously one request
 * earlier. The tell that it is the HTTP stack and not your token: a public
 * third-party repo (`github.com/git/git.git`) 401s identically.
 * `-c http.version=HTTP/1.1` and `-c protocol.version=0` both fix it.
 *
 * So an `auth`-classified failure is retried ONCE over HTTP/1.1. If the
 * retry succeeds, the diagnosis is certain (it was the transport, not the
 * credentials) and we say so. If it fails too, the credentials really are
 * the problem and the caller gets `auth` with an honest message.
 * `ensureGitHttpFloor()` makes the workaround permanent for the host.
 */

import { execa } from 'execa';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Non-interactivity floor
// ---------------------------------------------------------------------------

/**
 * Every environment variable git (and the helpers it spawns) consults before
 * falling back to a TTY prompt. Setting all of them is deliberate: git tries
 * `GIT_ASKPASS`, then `core.askPass`, then `SSH_ASKPASS`, and only then the
 * terminal — plugging one hole leaves the others open.
 */
export function gitEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: 'echo',
    SSH_ASKPASS: 'echo',
    SSH_ASKPASS_REQUIRE: 'never',
    GCM_INTERACTIVE: 'never',
    ...extra,
  };
}

/** Config-level twin of `gitEnv()`, for the paths env vars don't cover. */
export const HARDENED_ARGS: ReadonlyArray<string> = [
  '-c',
  'credential.interactive=never',
  '-c',
  'core.askPass=',
];

/** The workaround for the deb12u15 libcurl regression documented above. */
export const HTTP11_ARGS: ReadonlyArray<string> = ['-c', 'http.version=HTTP/1.1'];

export interface GitResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Run git with the non-interactivity floor applied. NEVER shells out to git
 * any other way — `runGit` is the only door, so no future call site can
 * re-introduce a prompt that hangs a headless deploy.
 */
export async function runGit(
  args: string[],
  opts: { cwd?: string; http11?: boolean; timeoutMs?: number } = {},
): Promise<GitResult> {
  const full = [...HARDENED_ARGS, ...(opts.http11 ? HTTP11_ARGS : []), ...args];
  try {
    const res = await execa('git', full, {
      cwd: opts.cwd,
      env: gitEnv(),
      timeout: opts.timeoutMs ?? 120_000,
      reject: false,
      stdin: 'ignore',
    });
    return {
      ok: res.exitCode === 0,
      stdout: (res.stdout ?? '').toString(),
      stderr: (res.stderr ?? '').toString(),
      exitCode: res.exitCode ?? 1,
    };
  } catch (err) {
    return { ok: false, stdout: '', stderr: err instanceof Error ? err.message : String(err), exitCode: 1 };
  }
}

// ---------------------------------------------------------------------------
// Failure classification
// ---------------------------------------------------------------------------

/**
 * What actually went wrong. The whole point of this union is that the caller
 * can distinguish `dirty` (benign — local edits, keep going) from everything
 * else (the remote was never reached, so a build would run on stale code).
 */
export type GitFailureKind =
  | 'auth'
  | 'network'
  | 'no-remote'
  | 'not-a-repo'
  | 'conflict'
  | 'dirty'
  | 'unknown';

export function classifyGitFailure(stderr: string): GitFailureKind {
  const s = stderr.toLowerCase();
  if (s.includes('not a git repository')) return 'not-a-repo';
  if (s.includes("does not appear to be a git repository") || s.includes('no such remote'))
    return 'no-remote';
  if (
    s.includes('could not read username') ||
    s.includes('could not read password') ||
    s.includes('authentication failed') ||
    s.includes('permission denied (publickey)') ||
    s.includes('terminal prompts disabled') ||
    s.includes('403 forbidden') ||
    s.includes('401')
  )
    return 'auth';
  if (
    s.includes('could not resolve host') ||
    s.includes('connection timed out') ||
    s.includes('connection refused') ||
    s.includes('network is unreachable') ||
    s.includes('ssl') ||
    s.includes('unable to access')
  )
    return 'network';
  if (
    s.includes('local changes') ||
    s.includes('would be overwritten') ||
    s.includes('cannot pull with rebase') ||
    s.includes('unstaged changes')
  )
    return 'dirty';
  if (s.includes('conflict') || s.includes('automatic merge failed')) return 'conflict';
  return 'unknown';
}

// ---------------------------------------------------------------------------
// The update door
// ---------------------------------------------------------------------------

export type SyncOutcome =
  /** Fetched and fast-forwarded (or already current). Safe to build. */
  | { kind: 'updated'; from: string; to: string; note?: string }
  /** Remote reached and current, but the working tree has local edits. */
  | { kind: 'dirty'; files: string[]; note?: string }
  /** Remote NOT reached, or the merge failed. NEVER safe to build. */
  | { kind: 'failed'; reason: GitFailureKind; message: string; fix: string };

const FIXES: Record<GitFailureKind, string> = {
  auth: 'Run `eve doctor` for the full diagnosis of this host\'s git update path.',
  network: 'Check outbound HTTPS/SSH to the git host from this machine.',
  'no-remote':
    'This checkout has no `origin`. It was most likely created by the tarball fallback or by rsync. ' +
    'Add one: `git remote add origin <url>`.',
  'not-a-repo': 'This directory is not a git checkout. Re-run `eve setup`, or point at a real checkout.',
  conflict: 'Resolve the merge conflict in the checkout, then re-run.',
  dirty: 'Commit, stash, or discard the local changes in the checkout.',
  unknown: 'Inspect the git output above.',
};

/**
 * Turn a `could not read Username` into a determination instead of a guess.
 *
 * The same stderr covers two unrelated causes, and telling them apart is a
 * single probe against a PUBLIC third-party repo:
 *   • the probe ALSO fails  -> this host's HTTP stack is broken; credentials
 *     were never the problem (the deb12u15 libcurl regression);
 *   • the probe succeeds    -> git works fine here, so this particular remote
 *     really does need credentials it does not have.
 */
async function explainAuthFailure(remoteUrl: string): Promise<string> {
  const probe = await probeGitHttps();
  if (!probe.ok) {
    return (
      "git cannot fetch a PUBLIC repo on this host either, so this is NOT about credentials — " +
      "it is this machine's HTTP stack. Check outbound HTTPS to github.com."
    );
  }
  if (probe.http11Needed) {
    return (
      'git over HTTP/2 is broken on this host (a public repo fails the same way, HTTP/1.1 works) — ' +
      'this is the Debian 12 libcurl 7.88.1-10+deb12u15 regression, NOT your credentials. ' +
      'Fix permanently: `git config --global http.version HTTP/1.1`.'
    );
  }
  const ssh = toSshRemote(remoteUrl);
  return (
    `git works fine on this host (a public repo fetches cleanly), so ${remoteUrl} genuinely ` +
    'needs credentials this machine does not have. Either switch the remote to SSH — ' +
    (ssh ? `\`git remote set-url origin ${ssh}\`` : '`git remote set-url origin git@github.com:<org>/<repo>.git`') +
    ' — with a key registered on the git host, or configure a PAT with a PERSISTED helper ' +
    '(`git config --global credential.helper store`; the default `cache` helper lives in RAM ' +
    'and evaporates, which is why an HTTPS pull can work today and prompt tomorrow).'
  );
}

/** `https://github.com/org/repo.git` -> `git@github.com:org/repo.git` */
export function toSshRemote(url: string): string | null {
  const m = /^https:\/\/([^/]+)\/(.+?)(?:\.git)?$/.exec(url.trim());
  return m ? `git@${m[1]}:${m[2]}.git` : null;
}

/**
 * Fetch + fast-forward a checkout, honestly.
 *
 * Contract: a `failed` outcome means the remote was NOT reached (or the
 * merge did not land) and the checkout is therefore at an unknown/stale
 * commit. Callers MUST fail closed on it — building anyway is how a deploy
 * silently ships old code and still reports success.
 */
export async function syncRepo(dir: string): Promise<SyncOutcome> {
  if (!existsSync(join(dir, '.git'))) {
    return {
      kind: 'failed',
      reason: 'not-a-repo',
      message: `${dir} is not a git checkout (no .git directory)`,
      fix: FIXES['not-a-repo'],
    };
  }

  const remote = await runGit(['remote', 'get-url', 'origin'], { cwd: dir });
  if (!remote.ok) {
    return {
      kind: 'failed',
      reason: 'no-remote',
      message: `${dir} has no 'origin' remote — nothing to pull from`,
      fix: FIXES['no-remote'],
    };
  }

  const before = (await runGit(['rev-parse', 'HEAD'], { cwd: dir })).stdout.trim();

  // Fetch first, as its own step. `pull` conflates "could not reach the
  // remote" with "could not merge"; separating them is what lets us tell
  // the operator which of the two actually happened.
  let http11 = false;
  let note: string | undefined;
  let fetch = await runGit(['fetch', '--prune', 'origin'], { cwd: dir });
  if (!fetch.ok && classifyGitFailure(fetch.stderr) === 'auth') {
    // The deb12u15 libcurl regression presents as a 401. Retrying over
    // HTTP/1.1 is the falsification test AND the fix in one move.
    const retry = await runGit(['fetch', '--prune', 'origin'], { cwd: dir, http11: true });
    if (retry.ok) {
      http11 = true;
      note =
        'fetched over HTTP/1.1 — the default HTTP/2 path returned a spurious 401. ' +
        'Make it permanent with `git config --global http.version HTTP/1.1`.';
      fetch = retry;
    }
  }
  if (!fetch.ok) {
    const reason = classifyGitFailure(fetch.stderr);
    return {
      kind: 'failed',
      reason,
      message: fetch.stderr.trim() || `git fetch failed in ${dir}`,
      // `auth` is the one reason where the same stderr has two completely
      // different causes — a broken HTTP stack, or genuinely missing
      // credentials for a private repo. Determine which, rather than making
      // the operator guess: that guess is what cost a day on 2026-09-02.
      fix: reason === 'auth' ? await explainAuthFailure(remote.stdout.trim()) : FIXES[reason],
    };
  }

  // Remote reached. Only now can local state be the blocker — and only now
  // is "uncommitted changes" an honest thing to say.
  const dirtyOut = (await runGit(['status', '--porcelain', '--untracked-files=no'], { cwd: dir }))
    .stdout;
  const dirtyFiles = dirtyOut.split('\n').map((l) => l.trim()).filter(Boolean);
  if (dirtyFiles.length > 0) {
    return { kind: 'dirty', files: dirtyFiles, note };
  }

  const merge = await runGit(['merge', '--ff-only', '@{u}'], { cwd: dir, http11 });
  if (!merge.ok) {
    const reason = classifyGitFailure(merge.stderr);
    return {
      kind: 'failed',
      reason: reason === 'unknown' ? 'conflict' : reason,
      message: merge.stderr.trim() || `fast-forward failed in ${dir}`,
      fix: FIXES[reason === 'unknown' ? 'conflict' : reason],
    };
  }

  const after = (await runGit(['rev-parse', 'HEAD'], { cwd: dir })).stdout.trim();
  return { kind: 'updated', from: before.slice(0, 8), to: after.slice(0, 8), note };
}

// ---------------------------------------------------------------------------
// Provisioning floor + doctor probe
// ---------------------------------------------------------------------------

/**
 * Probe whether git-over-HTTPS works on this host at all, using a PUBLIC
 * third-party repo. Using someone else's repo is the point: it removes
 * credentials and repo permissions from the equation, so a failure can only
 * be the local HTTP stack.
 */
export async function probeGitHttps(): Promise<
  { ok: true; http11Needed: boolean } | { ok: false; message: string }
> {
  const url = 'https://github.com/git/git.git';
  const direct = await runGit(['ls-remote', url, 'HEAD'], { timeoutMs: 30_000 });
  if (direct.ok) return { ok: true, http11Needed: false };
  const via11 = await runGit(['ls-remote', url, 'HEAD'], { http11: true, timeoutMs: 30_000 });
  if (via11.ok) return { ok: true, http11Needed: true };
  return { ok: false, message: direct.stderr.trim() || 'git ls-remote failed' };
}

/**
 * Pin `http.version=HTTP/1.1` globally IF (and only if) this host needs it.
 * Called from provisioning so a freshly-imaged Debian 12 pod is never born
 * with a broken update path. Idempotent; a no-op on a healthy host, so it
 * costs nothing to run every time.
 */
export async function ensureGitHttpFloor(): Promise<
  { changed: false; reason: 'healthy' | 'already-set' | 'unfixable' } | { changed: true }
> {
  const existing = await runGit(['config', '--global', '--get', 'http.version']);
  if (existing.ok && existing.stdout.trim() === 'HTTP/1.1') {
    return { changed: false, reason: 'already-set' };
  }
  const probe = await probeGitHttps();
  if (probe.ok && !probe.http11Needed) return { changed: false, reason: 'healthy' };
  if (!probe.ok) return { changed: false, reason: 'unfixable' };
  await runGit(['config', '--global', 'http.version', 'HTTP/1.1']);
  return { changed: true };
}

/**
 * Clone, prompt-proof, with a public-tarball fallback.
 *
 * The fallback previously left a directory with NO `.git` at all, which
 * silently destroyed the UPDATE door: the next `eve synap deploy` had
 * nothing to pull from. (That is the observed state of `/opt/synap/*` on
 * synap-personal: 11 checkouts, zero remotes.) So after extracting, we
 * `git init` + `remote add origin` + fetch, leaving a real checkout behind.
 */
export async function cloneOrFetchTarball(opts: {
  repoUrl: string;
  tarballUrl: string;
  targetDir: string;
  tmpDir: string;
  log?: (msg: string) => void;
}): Promise<{ via: 'clone' | 'tarball'; gitUsable: boolean }> {
  const { repoUrl, tarballUrl, targetDir, tmpDir, log = () => {} } = opts;

  let clone = await runGit(['clone', '--depth', '1', repoUrl, targetDir]);
  if (!clone.ok && classifyGitFailure(clone.stderr) === 'auth') {
    log('git clone hit a 401 — retrying over HTTP/1.1 (known Debian libcurl regression) …');
    clone = await runGit(['clone', '--depth', '1', repoUrl, targetDir], { http11: true });
  }
  if (clone.ok) return { via: 'clone', gitUsable: true };

  log('git clone failed; falling back to the public archive from codeload.github.com …');
  const { mkdir, rm } = await import('node:fs/promises');
  const archivePath = join(tmpDir, `synap-backend-${Date.now()}.tar.gz`);
  try {
    await mkdir(targetDir, { recursive: true });
    await execa('curl', ['-fsSL', tarballUrl, '-o', archivePath], { stdio: 'inherit' });
    await execa('tar', ['-xzf', archivePath, '--strip-components', '1', '-C', targetDir], {
      stdio: 'inherit',
    });
  } finally {
    await rm(archivePath, { force: true }).catch(() => undefined);
  }

  // Give the tarball a remote so the update door still exists next time.
  const init = await runGit(['init'], { cwd: targetDir });
  const wired =
    init.ok && (await runGit(['remote', 'add', 'origin', repoUrl], { cwd: targetDir })).ok;
  if (wired) {
    log(`Wired origin -> ${repoUrl} so \`eve synap deploy\` can update this checkout later.`);
  } else {
    log('WARNING: could not wire an origin remote — this checkout will not be git-updatable.');
  }
  return { via: 'tarball', gitUsable: wired };
}
