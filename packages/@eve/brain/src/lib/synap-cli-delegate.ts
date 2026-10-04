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
import { join } from 'node:path';
import {
  readSynapEnvValue,
  synapApplyAt,
  synapConfigSetAt,
  synapConfigUnsetAt,
  type SynapConfigDoorOptions,
  type SynapConfigResult,
} from '@eve/dna';
import { resolveSynapDelegate, type SynapDelegatePaths } from './synap-delegate.js';

export type { SynapConfigResult };

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

/** `KEY=` from a deploy .env (last assignment, one pair of quotes removed), or undefined. Read-only. */
export const readEnvValue = readSynapEnvValue;

/** `COMPOSE_PROJECT_NAME=` from a deploy .env, or undefined. */
export function readEnvPin(envPath: string): string | undefined {
  return readEnvValue(envPath, 'COMPOSE_PROJECT_NAME');
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
  | 'reset'
  | 'setup';

export interface RunSynapCliOptions {
  /** Domain to expose to the CLI as `DOMAIN=...`. Defaults to whatever is in .env. */
  domain?: string;
  /** Stream child stdout/stderr to the parent (default true). */
  inherit?: boolean;
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

/**
 * The ONE argv for `synap update` from eve (dashboard lifecycle and
 * `eve update synap` alike — they used to disagree: `--from-image` vs `[]`).
 * `synap update` applies a RELEASE: an explicit id / channel when given, else
 * the pod's own SYNAP_UPDATE_CHANNEL (default stable) — eve never re-derives
 * the channel rule itself.
 */
export function synapUpdateArgs(release?: string): string[] {
  const ref = release?.trim();
  return ref ? ['--release', ref] : [];
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

  // The pod's code is never refreshed from git here any more: `synap update`
  // applies a RELEASE (manifest + deploy bundle) — update-door plan P4.
  //
  // When the caller supplies a domain, heal a DOMAIN= written with the bare
  // root instead of eve's pod FQDN (pod.<root>) — through the pod's ONE
  // validated .env writer, never a direct file write. The CLI regenerates
  // kratos.yml from .env, so a wrong DOMAIN yields wrong Kratos URLs.
  if (options.domain) {
    const fqdn = toPodFqdn(options.domain);
    if (readEnvValue(join(paths.deployDir, '.env'), 'DOMAIN') !== fqdn) {
      const healed = synapConfigSet({ DOMAIN: fqdn }, { deployDir: paths.deployDir });
      if (!healed.ok) {
        console.warn(`  Warning: could not set DOMAIN=${fqdn} through synap config: ${healed.stderr.trim() || healed.stdout.trim()}`);
      }
    }
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
  // Compose project name: an operator's env override, else the pod's own pin
  // in deploy/.env. Never a hard-coded default: forcing `synap-backend` here
  // overrode a pod pinned to another name (→ an empty parallel stack) and hid
  // the synap CLI's refusal when two projects own a postgres for one deploy
  // dir (update-door plan P0, 2026-10-04). Unpinned → the CLI resolves it,
  // refuses when ambiguous, and writes the pin.
  const projectName =
    process.env.COMPOSE_PROJECT_NAME?.trim() || readEnvPin(join(paths.deployDir, '.env'));
  if (projectName) env.COMPOSE_PROJECT_NAME = projectName;
  else delete env.COMPOSE_PROJECT_NAME;
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

// ── The pod's ONE .env writer ────────────────────────────────────────────────
// Implementation: @eve/dna synap-config-door.ts (shared with dna callers).
// These wrappers only resolve a default deploy dir.

export interface SynapConfigOptions extends SynapConfigDoorOptions {
  /** The pod's deploy dir (`<root>/deploy`); default: resolveSynapDelegate(). */
  deployDir?: string;
}

function resolveDeployDir(deployDir?: string): string | null {
  return deployDir ?? resolveSynapDelegate()?.deployDir ?? null;
}
const noPod: SynapConfigResult = {
  ok: false, changed: [], exitCode: -1, stdout: '',
  stderr: 'synap CLI not found — set SYNAP_REPO_ROOT, or run `eve install synap`',
};

/** `synap config set` — KEY=VALUE pairs on stdin, all-or-nothing. */
export function synapConfigSet(entries: Record<string, string>, options: SynapConfigOptions = {}): SynapConfigResult {
  const dir = resolveDeployDir(options.deployDir);
  return dir ? synapConfigSetAt(dir, entries, options) : noPod;
}

/** `synap config unset` — removes keys through the same validated door. */
export function synapConfigUnset(keys: string[], options: SynapConfigOptions = {}): SynapConfigResult {
  const dir = resolveDeployDir(options.deployDir);
  return dir ? synapConfigUnsetAt(dir, keys, options) : noPod;
}

/** `synap apply` — guarded recreate of the running services whose config changed. */
export function synapApply(options: SynapConfigOptions = {}): SynapConfigResult {
  const dir = resolveDeployDir(options.deployDir);
  return dir ? synapApplyAt(dir) : noPod;
}
