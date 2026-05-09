/**
 * Delegate to the canonical synap CLI (bash binary at <repoRoot>/synap).
 *
 * Eve previously reimplemented synap-backend's deploy/install/update logic in
 * TypeScript. That reimplementation drifted (no --force-recreate kratos,
 * missing CREATE DATABASE idempotency, no canary flow). The synap CLI is the
 * source of truth — eve invokes it and layers eve-specific concerns
 * (eve-network, agent provisioning, AI wiring cascade, kratos webhook) on top.
 *
 * See: hestia-cli/.docs/synap-cli-as-source-of-truth.md
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolveSynapDelegate, type SynapDelegatePaths } from './synap-delegate.js';

export type SynapCliSubcommand =
  | 'install'
  | 'update'
  | 'restart'
  | 'start'
  | 'stop'
  | 'ps'
  | 'health'
  | 'connectivity'
  | 'logs'
  | 'rebuild'
  | 'config'
  | 'shell'
  | 'exec'
  | 'profiles'
  | 'backup'
  | 'restore'
  | 'clean'
  | 'errors'
  | 'diagnose';

export interface RunSynapCliOptions {
  /** Domain to expose to the CLI as `DOMAIN=...`. Defaults to whatever is in .env. */
  domain?: string;
  /** Stream child stdout/stderr to the parent (default true). */
  inherit?: boolean;
  /**
   * Pull the latest synap-backend git checkout before invoking the CLI.
   * Keeps the bash binary in lockstep with the docker images. Skipped silently
   * when the deploy dir is not a git checkout.
   */
  refreshGit?: boolean;
}

export interface SynapCliResult {
  ok: boolean;
  exitCode: number;
  paths: SynapDelegatePaths | null;
  /** Stderr captured when inherit=false. Empty when inherit=true. */
  stderr: string;
}

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

function refreshGitCheckout(repoRoot: string): void {
  if (!existsSync(`${repoRoot}/.git`)) return;
  spawnSync('git', ['-C', repoRoot, 'fetch', '--quiet'], { stdio: 'ignore' });
  spawnSync('git', ['-C', repoRoot, 'pull', '--ff-only', '--quiet'], { stdio: 'ignore' });
}

/**
 * Invoke the canonical synap CLI. Resolves the deploy dir via
 * resolveSynapDelegate() (honors SYNAP_CLI / SYNAP_REPO_ROOT / .eve/state.json
 * / well-known paths), sets `SYNAP_DEPLOY_DIR`, `SYNAP_ASSUME_YES`,
 * `SYNAP_NON_INTERACTIVE`, and optionally `DOMAIN`, then spawns
 * `bash <synapScript> <subcommand> <...args>`.
 *
 * Returns `{ ok: false, paths: null }` when no synap deploy dir is found —
 * the caller decides whether to surface this as an error.
 */
export function runSynapCli(
  subcommand: SynapCliSubcommand,
  args: string[] = [],
  options: RunSynapCliOptions = {},
): SynapCliResult {
  const paths = resolveSynapDelegate();
  if (!paths) {
    return {
      ok: false,
      exitCode: -1,
      paths: null,
      stderr: 'synap CLI not found — set SYNAP_REPO_ROOT or install synap-backend',
    };
  }

  if (options.refreshGit) {
    refreshGitCheckout(paths.repoRoot);
  }

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    SYNAP_DEPLOY_DIR: paths.deployDir,
    SYNAP_ASSUME_YES: '1',
    SYNAP_NON_INTERACTIVE: '1',
  };
  if (options.domain) {
    env.DOMAIN = options.domain;
  }

  const inherit = options.inherit !== false;
  const result = spawnSync('bash', [paths.synapScript, subcommand, ...args], {
    cwd: paths.deployDir,
    env,
    stdio: inherit ? 'inherit' : 'pipe',
    timeout: DEFAULT_TIMEOUT_MS,
  });

  return {
    ok: result.status === 0,
    exitCode: result.status ?? -1,
    paths,
    stderr: inherit ? '' : (result.stderr?.toString() ?? ''),
  };
}
