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
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveSynapDelegate, type SynapDelegatePaths } from './synap-delegate.js';

/**
 * Eve convention: the synap pod is reachable at `pod.<root>` where `<root>`
 * is the bare domain stored in `secrets.domain.primary`. The synap CLI's
 * `generate_kratos_config` does NOT add this prefix — it templates URLs as
 * `https://${domain}/...`. So eve must pass the FQDN, not the bare root.
 *
 * Idempotent: a value that already starts with `pod.` is returned unchanged.
 * `localhost` and IP literals are returned unchanged (no subdomain concept).
 */
export function toPodFqdn(input: string): string {
  const trimmed = input.trim();
  if (!trimmed || trimmed === 'localhost') return trimmed;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(trimmed)) return trimmed; // IPv4 literal
  if (trimmed.startsWith('pod.')) return trimmed;
  return `pod.${trimmed}`;
}

/**
 * Rewrite (or append) a `DOMAIN=...` line in a `.env` file. Used to repair
 * existing installs whose .env was written with the bare root instead of the
 * pod FQDN before this fix landed.
 */
function rewriteEnvDomain(envPath: string, fqdn: string): boolean {
  if (!existsSync(envPath)) return false;
  const current = readFileSync(envPath, 'utf-8');
  const existing = current.match(/^DOMAIN=(.*)$/m)?.[1]?.trim();
  if (existing === fqdn) return false;
  const next = current.match(/^DOMAIN=.*$/m)
    ? current.replace(/^DOMAIN=.*$/m, `DOMAIN=${fqdn}`)
    : `${current}${current.endsWith('\n') ? '' : '\n'}DOMAIN=${fqdn}\n`;
  writeFileSync(envPath, next, { encoding: 'utf-8', mode: 0o600 });
  return true;
}

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
  | 'diagnose'
  | 'setup';

export interface RunSynapCliOptions {
  /** Domain to expose to the CLI as `DOMAIN=...`. Defaults to whatever is in .env. */
  domain?: string;
  /** Stream child stdout/stderr to the parent (default true). */
  inherit?: boolean;
  /**
   * Pull the latest synap-backend git checkout before invoking the CLI.
   * Keeps the bash binary in lockstep with the docker images. Logs a warning
   * if the repo has uncommitted edits (`git pull --ff-only` rejects); skipped
   * silently when the deploy dir is not a git checkout.
   */
  refreshGit?: boolean;
  /**
   * Explicit synap-backend git repo root. Bypasses `resolveSynapDelegate`
   * — required when installing into a non-default path (e.g. `/srv/...`).
   * Must contain `synap` script and `deploy/docker-compose.yml`.
   */
  repoRoot?: string;
}

export interface SynapCliResult {
  ok: boolean;
  exitCode: number;
  paths: SynapDelegatePaths | null;
  /** Stdout captured when inherit=false. Empty when inherit=true. */
  stdout: string;
  /** Stderr captured when inherit=false. Empty when inherit=true. */
  stderr: string;
}

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

function refreshGitCheckout(repoRoot: string): void {
  if (!existsSync(`${repoRoot}/.git`)) return;
  spawnSync('git', ['-C', repoRoot, 'fetch', '--quiet'], { stdio: 'ignore' });
  const pull = spawnSync('git', ['-C', repoRoot, 'pull', '--ff-only'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf-8',
  });
  if (pull.status !== 0) {
    const detail = (pull.stderr ?? '').toString().trim() || 'rejected (likely local edits or non-fast-forward).';
    console.warn(`  Warning: git pull on ${repoRoot} failed — ${detail}\n  Continuing with the on-disk synap-backend (may be older than upstream).`);
  }
}

function resolveExplicitRepo(repoRoot: string): SynapDelegatePaths | null {
  const synapScript = `${repoRoot}/synap`;
  const deployDir = `${repoRoot}/deploy`;
  if (!existsSync(synapScript)) return null;
  if (!existsSync(`${deployDir}/docker-compose.yml`)) return null;
  return { repoRoot, synapScript, deployDir };
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
  const paths = options.repoRoot
    ? resolveExplicitRepo(options.repoRoot)
    : resolveSynapDelegate();
  if (!paths) {
    return {
      ok: false,
      exitCode: -1,
      paths: null,
      stdout: '',
      stderr: options.repoRoot
        ? `synap CLI not found at ${options.repoRoot} — expected ${options.repoRoot}/synap and ${options.repoRoot}/deploy/docker-compose.yml`
        : diagnoseMissingSynapCli(),
    };
  }

  if (options.refreshGit) {
    refreshGitCheckout(paths.repoRoot);
  }

  // When the caller supplies a domain, ensure the value matches eve's pod
  // FQDN convention (pod.<root>) and rewrite the .env's DOMAIN= line to
  // match. The CLI's `cmd_update` regenerates kratos.yml from .env every
  // run, so a wrong DOMAIN= here yields wrong kratos URLs.
  if (options.domain) {
    const fqdn = toPodFqdn(options.domain);
    rewriteEnvDomain(join(paths.deployDir, '.env'), fqdn);
  }

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    SYNAP_DEPLOY_DIR: paths.deployDir,
    SYNAP_ASSUME_YES: '1',
    SYNAP_NON_INTERACTIVE: '1',
    // Eve always provides the edge proxy (eve-legs-traefik on port 80/443).
    // Tell the synap CLI to skip its built-in Caddy so it doesn't fight
    // Traefik for port 80 and abort updates with "port already allocated".
    SYNAP_SKIP_EDGE: '1',
  };
  if (options.domain) {
    env.DOMAIN = toPodFqdn(options.domain);
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
    stdout: inherit ? '' : (result.stdout?.toString() ?? ''),
    stderr: inherit ? '' : (result.stderr?.toString() ?? ''),
  };
}

/**
 * Build a useful error when `resolveSynapDelegate` returns null.
 *
 * Distinguishes the two real cases:
 *   1. No `/opt/synap-backend` at all — fresh server, never installed.
 *   2. A FLAT-layout install exists (compose at `<root>/docker-compose.yml`
 *      with no `.git` and no `synap` script). This is a pre-Phase-3 install;
 *      eve no longer ships its own compose so the user must migrate to the
 *      canonical synap-backend git-checkout layout.
 */
function diagnoseMissingSynapCli(): string {
  const candidate = process.env.SYNAP_REPO_ROOT?.trim() || '/opt/synap-backend';
  const hasFlatCompose = existsSync(`${candidate}/docker-compose.yml`);
  const hasGit = existsSync(`${candidate}/.git`);
  const hasScript = existsSync(`${candidate}/synap`);

  if (hasFlatCompose && !hasGit && !hasScript) {
    return [
      'synap CLI not found — pre-cutover flat-layout install detected at ' + candidate + '.',
      '',
      'Eve no longer bundles its own compose file; the canonical synap-backend git checkout is required.',
      'Migrate (preserves docker volumes — your data is safe):',
      '',
      '  docker compose -f ' + candidate + '/docker-compose.yml down',
      '  sudo mv ' + candidate + ' ' + candidate + '.legacy',
      '  sudo git clone --depth 1 https://github.com/synap-core/backend.git ' + candidate,
      '  sudo mv ' + candidate + '.legacy/.env ' + candidate + '/deploy/.env',
      '  sudo mv ' + candidate + '.legacy/docker-compose.override.yml ' + candidate + '/deploy/ 2>/dev/null || true',
      '  eve update synap   # synap CLI now visible; runs canonical update + reconnects eve-network',
      '',
      'After verifying the pod is healthy, you can `sudo rm -rf ' + candidate + '.legacy`.',
    ].join('\n');
  }

  return 'synap CLI not found at ' + candidate + '/synap — set SYNAP_REPO_ROOT, or run `eve install synap`.';
}
