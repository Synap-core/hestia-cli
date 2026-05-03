/**
 * `eve auth` — introspect and renew the Synap agent API key.
 *
 * Three subcommands:
 *   - `eve auth status`  → resolves the configured pod URL + key, calls
 *                          `GET /api/hub/auth/status`, prints concrete
 *                          state (key prefix, user, scopes, age).
 *   - `eve auth whoami`  → tighter version of status (just the user line),
 *                          handy for piping or eyeballing.
 *   - `eve auth renew`   → re-runs the install-time mint path against
 *                          `POST /api/hub/setup/agent` (needs PROVISIONING_TOKEN),
 *                          atomically swaps `secrets.json`, prints the new prefix.
 *
 * Pattern mirrors `eve mode` — every action is idempotent, errors are
 * yielded as concrete fix hints, and we use the same `colors` / `emojis`
 * / `printX` helpers as the rest of the CLI so the output blends in.
 */

import { Command } from 'commander';
import {
  getAuthStatus,
  renewAgentKey,
  runActionToCompletion,
  type AuthFailure,
  type AuthStatus,
} from '@eve/lifecycle';
import { readEveSecrets } from '@eve/dna';
import { FallbackRunner, FetchRunner, DockerExecRunner } from '../lib/doctor-runners.js';
import {
  colors,
  emojis,
  printHeader,
  printSuccess,
  printError,
  printInfo,
  printWarning,
  createSpinner,
} from '../lib/ui.js';

// ---------------------------------------------------------------------------
// Resolve pod URL + key (shared by all subcommands)
// ---------------------------------------------------------------------------

interface ResolvedConfig {
  synapUrl: string;
  apiKey: string;
  apiKeyPrefix: string;
}

async function resolveConfig(): Promise<ResolvedConfig | null> {
  const secrets = await readEveSecrets(process.cwd());
  const synapUrl = secrets?.synap?.apiUrl?.trim() ?? '';
  const apiKey = secrets?.synap?.apiKey?.trim() ?? '';
  if (!synapUrl || !apiKey) {
    return null;
  }
  return { synapUrl, apiKey, apiKeyPrefix: apiKey.slice(0, 8) };
}

/**
 * Build a runner that tries native fetch first and swaps to docker-exec
 * when the host loopback isn't reachable. Same pattern `eve doctor` uses
 * — Eve deployments behind Traefik have no host port mapping, so a probe
 * to `http://127.0.0.1:4000` would otherwise just fail.
 */
function buildRunner(): FallbackRunner {
  return new FallbackRunner(
    new FetchRunner(),
    new DockerExecRunner(),
    () => {
      // Discard the swap note here — the auth UI is concise and doesn't
      // need to surface the transport detail. `eve doctor` is the place
      // for verbose runner reporting.
    },
  );
}

// ---------------------------------------------------------------------------
// `eve auth status`
// ---------------------------------------------------------------------------

async function runStatus(): Promise<void> {
  console.log();
  printHeader('Synap auth status');
  console.log();

  const cfg = await resolveConfig();
  if (!cfg) {
    printInfo(`  Pod:       ${colors.muted('(not configured)')}`);
    printInfo(`  Key:       ${colors.muted('(not configured)')}`);
    console.log();
    printWarning('skipped — no synap configured');
    printInfo('Fix: re-run `eve install` (or set secrets.synap.{apiUrl,apiKey} manually).');
    console.log();
    return;
  }

  const spinner = createSpinner(`Querying ${cfg.synapUrl}/api/hub/auth/status…`);
  spinner.start();
  const result = await getAuthStatus({
    synapUrl: cfg.synapUrl,
    apiKey: cfg.apiKey,
    runner: buildRunner(),
  });
  spinner.succeed('Auth check complete');

  console.log();
  console.log(`  ${colors.muted('Pod:'.padEnd(11))} ${colors.info(cfg.synapUrl)}  ${colors.muted('(resolved via secrets.synap.apiUrl)')}`);
  console.log(`  ${colors.muted('Key:'.padEnd(11))} ${cfg.apiKeyPrefix}…  ${colors.muted('(prefix shown)')}`);

  if (result.ok) {
    renderActiveStatus(result.status);
  } else {
    renderFailure(result.failure);
  }
  console.log();
}

function renderActiveStatus(s: AuthStatus): void {
  const userLine = s.userEmail ? `${s.userId.slice(0, 8)}  (${s.userEmail})` : s.userId.slice(0, 8);
  console.log(`  ${colors.muted('User:'.padEnd(11))} ${userLine}`);
  if (s.name) {
    console.log(`  ${colors.muted('Name:'.padEnd(11))} ${s.name}`);
  }
  const scopes = s.scopes.length > 0 ? s.scopes.join(', ') : colors.muted('(none)');
  console.log(`  ${colors.muted('Scopes:'.padEnd(11))} ${scopes}`);
  console.log(`  ${colors.muted('Age:'.padEnd(11))} ${s.ageDays} day${s.ageDays === 1 ? '' : 's'}`);
  if (s.lastUsedAt) {
    console.log(`  ${colors.muted('Last seen:'.padEnd(11))} ${s.lastUsedAt}`);
  }
  if (s.expiresAt) {
    console.log(`  ${colors.muted('Expires:'.padEnd(11))} ${s.expiresAt}`);
  }
  console.log(`  ${colors.muted('Status:'.padEnd(11))} ${colors.success(`${emojis.check} active`)}`);
}

function renderFailure(failure: AuthFailure): void {
  const { reason, message, missingScope } = failure;
  console.log(
    `  ${colors.muted('Status:'.padEnd(11))} ${colors.error(`${emojis.cross} ${reason}`)} — ${message}`,
  );

  // Per-reason fix hint (mirrors the diagnostics module so the hints stay
  // identical between `eve doctor` and `eve auth status`).
  let fix: string | null = null;
  switch (reason) {
    case 'key_revoked':
    case 'expired':
      fix = 'eve auth renew';
      break;
    case 'invalid_format':
      fix = 'Re-run `eve install` or `eve auth renew`';
      break;
    case 'no_auth':
      fix = 'Check ~/.eve/secrets/secrets.json has synap.apiKey set';
      break;
    case 'missing_scope':
      fix = missingScope
        ? `eve auth grant ${missingScope}`
        : 'Re-mint with required scopes (eve auth renew)';
      break;
    case 'backend_unhealthy':
      fix = 'docker logs synap-backend-backend-1 --tail 50';
      break;
    case 'transport':
      fix = 'Check the Synap container is running (eve doctor)';
      break;
    default:
      fix = null;
  }
  if (fix) {
    console.log(`  ${colors.muted('Fix:'.padEnd(11))} ${colors.info(fix)}`);
  }
}

// ---------------------------------------------------------------------------
// `eve auth whoami` — tight one-liner over the user
// ---------------------------------------------------------------------------

async function runWhoami(): Promise<void> {
  const cfg = await resolveConfig();
  if (!cfg) {
    printError('not configured — set secrets.synap.{apiUrl,apiKey} or re-run `eve install`');
    process.exitCode = 1;
    return;
  }
  const result = await getAuthStatus({
    synapUrl: cfg.synapUrl,
    apiKey: cfg.apiKey,
    runner: buildRunner(),
  });
  if (!result.ok) {
    printError(`auth failed (${result.failure.reason}): ${result.failure.message}`);
    process.exitCode = 1;
    return;
  }
  const s = result.status;
  const tag = s.userEmail ? `${s.userId.slice(0, 8)} <${s.userEmail}>` : s.userId.slice(0, 8);
  console.log(
    `${colors.success(emojis.check)} ${tag}  ${colors.muted(`(${s.scopes.length} scope${s.scopes.length === 1 ? '' : 's'}, key age ${s.ageDays}d, prefix ${cfg.apiKeyPrefix}…)`)}`,
  );
}

// ---------------------------------------------------------------------------
// `eve auth renew` — re-mint the agent key
// ---------------------------------------------------------------------------

interface RenewOptions {
  /** Skip the auto-restart of openwebui-pipelines after a successful renew. */
  skipPipelinesRestart?: boolean;
}

async function runRenew(opts: RenewOptions): Promise<void> {
  console.log();
  printHeader('Synap auth renew');
  console.log();

  const cfg = await resolveConfig();
  if (!cfg) {
    printError('No synap configured — nothing to renew. Run `eve install` first.');
    process.exitCode = 1;
    return;
  }

  printInfo(`Pod:           ${cfg.synapUrl}`);
  printInfo(`Previous key:  ${cfg.apiKeyPrefix}…`);
  console.log();

  const spinner = createSpinner('Calling POST /api/hub/setup/agent…');
  spinner.start();
  const result = await renewAgentKey({
    deployDir: process.cwd(),
    reason: 'manual',
  });
  if (!result.renewed) {
    spinner.fail('Renew failed');
    printError(result.reason);
    console.log();
    printInfo(
      'Common causes:\n' +
        '  • PROVISIONING_TOKEN was not persisted post-install — set EVE_PROVISIONING_TOKEN=<token> and retry.\n' +
        '  • Backend version too old — run `eve update synap`.\n' +
        '  • Network: pod unreachable from this host (`eve doctor`).',
    );
    process.exitCode = 1;
    return;
  }
  spinner.succeed(`Renewed agent key — new prefix ${result.keyIdPrefix}…`);

  console.log();
  printSuccess(`Renewed agent key (was ${cfg.apiKeyPrefix}…, now ${result.keyIdPrefix}…)`);
  printInfo('  secrets.json updated atomically.');

  // Downstream consumers cache the previous key in their .env files.
  // Best-effort restart of openwebui-pipelines (the most common consumer)
  // so the new key takes effect without operator action. Skip with --no-pipelines-restart.
  if (!opts.skipPipelinesRestart) {
    console.log();
    const rs = createSpinner('Restarting openwebui-pipelines to pick up the new key…');
    rs.start();
    try {
      const r = await runActionToCompletion('openwebui-pipelines', 'update');
      if (r.ok) {
        rs.succeed('openwebui-pipelines refreshed');
      } else {
        // Not installed / not running — soft-fail. The user may not even
        // have pipelines, in which case this is a no-op concern.
        rs.warn('openwebui-pipelines not refreshed (component may not be installed)');
        if (r.error && !r.error.includes('No update path')) {
          printInfo(`  ${colors.muted(r.error)}`);
        }
      }
    } catch (err) {
      rs.warn('openwebui-pipelines refresh threw — restart manually if needed');
      printInfo(`  ${colors.muted(err instanceof Error ? err.message : String(err))}`);
    }
  } else {
    printInfo('Skipping pipelines restart (--no-pipelines-restart).');
    printInfo('  Run `eve update openwebui-pipelines` to apply the new key downstream.');
  }
  console.log();
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function authCommand(program: Command): void {
  const auth = program
    .command('auth')
    .description(`${emojis.sparkles} Inspect, validate, and renew the Synap agent API key`);

  auth
    .command('status')
    .description('Show the current key prefix, user, scopes, age, and any failure reason.')
    .action(async () => {
      try {
        await runStatus();
      } catch (err) {
        printError(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      }
    });

  auth
    .command('whoami')
    .description('Tight one-liner — user, scopes count, key prefix.')
    .action(async () => {
      try {
        await runWhoami();
      } catch (err) {
        printError(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      }
    });

  auth
    .command('renew')
    .description('Re-mint the agent API key via POST /api/hub/setup/agent and atomically update secrets.json.')
    .option('--no-pipelines-restart', 'Skip the auto-restart of openwebui-pipelines after a successful renew.')
    .action(async (opts: { pipelinesRestart?: boolean }) => {
      // Commander turns `--no-pipelines-restart` into `pipelinesRestart: false`.
      const skipPipelinesRestart = opts.pipelinesRestart === false;
      try {
        await runRenew({ skipPipelinesRestart });
      } catch (err) {
        printError(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      }
    });
}
