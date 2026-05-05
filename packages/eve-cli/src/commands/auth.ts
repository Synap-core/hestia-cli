/**
 * `eve auth` — introspect, validate, and renew per-agent Synap keys.
 *
 * Synap mints a separate Hub Protocol key per `agentType` (eve, openclaw,
 * hermes, openwebui-pipelines, …). Each one has its own user, audit
 * trail, and scopes on the pod. Eve persists them under
 * `secrets.agents[agentType]`.
 *
 * Subcommands:
 *   - `eve auth status [--agent <slug>]`
 *       No flag → list every registered agent's status (one row per agent).
 *       With flag → detailed view of that one agent (key prefix, user,
 *       scopes, age, failure reason if any).
 *   - `eve auth whoami [--agent <slug>]`
 *       Tight one-liner. Defaults to the eve agent.
 *   - `eve auth renew [--agent <slug>] [--all]`
 *       Re-mint a key. `--all` walks the registry and renews each
 *       provisioned agent. Default = eve.
 *   - `eve auth provision`
 *       Mint missing keys for every installed component's agent.
 *       Useful after upgrading from a pre-per-agent install.
 *
 * Backwards compat: when no per-agent secrets exist yet but the legacy
 * `secrets.synap.apiKey` does, the default subject is the "eve" agent
 * — `writeAgentKey("eve", …)` mirrors back into `synap.apiKey`, so the
 * single-key world stays seamless until first migration.
 */

import { Command } from 'commander';
import {
  checkNeedsAdmin,
  ensurePodProvisioningToken,
  getAuthStatus,
  provisionAgent,
  provisionAllAgents,
  renewAgentKey,
  runActionToCompletion,
  runBackendPreflight,
  type AuthFailure,
  type AuthStatus,
  type ProvisionResult,
} from '@eve/lifecycle';
import {
  AGENTS,
  entityStateManager,
  findPodDeployDir,
  readAgentKey,
  readEveSecrets,
  resolveAgent,
  resolveSynapUrlOnHost,
  type AgentInfo,
} from '@eve/dna';
import { ensureKratosRunning } from '@eve/brain';
import { buildPodRunner } from '../lib/doctor-runners.js';
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
import { runSetupAdminInline } from './setup-admin.js';

// ---------------------------------------------------------------------------
// Resolve pod URL + per-agent key
// ---------------------------------------------------------------------------

interface ResolvedAgentConfig {
  agentType: string;
  agent: AgentInfo;
  synapUrl: string;
  apiKey: string;
  apiKeyPrefix: string;
}

/**
 * Resolve config for one agent. Returns `null` when the pod URL is
 * unconfigured or no key exists for this agent (and no legacy fallback
 * applies).
 */
async function resolveAgentConfig(
  agentType: string,
): Promise<ResolvedAgentConfig | null> {
  const agent = resolveAgent(agentType);
  if (!agent) return null;

  const secrets = await readEveSecrets(process.cwd());
  // On-host: prefer the loopback published by Eve's compose override.
  // Off-host: this transparently falls back to the public URL.
  const synapUrl = await resolveSynapUrlOnHost(secrets);
  if (!synapUrl) return null;

  // Per-agent key first, then fall back to the legacy single-key field
  // ONLY for the eve agent (so older installs keep working until they
  // migrate). Other agents have no legacy fallback — they need their
  // own key minted via `eve auth provision`.
  const perAgent = await readAgentKey(agentType, process.cwd());
  let apiKey = perAgent?.hubApiKey?.trim() ?? '';
  if (!apiKey && agentType === 'eve') {
    apiKey = secrets?.synap?.apiKey?.trim() ?? '';
  }
  if (!apiKey) return null;

  return {
    agentType,
    agent,
    synapUrl,
    apiKey,
    apiKeyPrefix: apiKey.slice(0, 8),
  };
}

// Auth UI is concise — discard the transport note. `eve doctor` is the
// place for verbose runner reporting.
const buildRunner = () => buildPodRunner();

// ---------------------------------------------------------------------------
// `eve auth status` — list-or-detail
// ---------------------------------------------------------------------------

interface StatusOptions {
  agent?: string;
}

async function runStatus(opts: StatusOptions): Promise<void> {
  console.log();
  printHeader(opts.agent ? `Synap auth status — ${opts.agent}` : 'Synap auth status');
  console.log();

  if (opts.agent) {
    const targeted = resolveAgent(opts.agent);
    if (!targeted) {
      printError(`Unknown agent: ${opts.agent}.`);
      printInfo(`Available: ${AGENTS.map((a) => a.agentType).join(', ')}`);
      process.exitCode = 1;
      return;
    }
    await renderAgentDetail(targeted);
    console.log();
    return;
  }

  // No `--agent` → table of every registered agent's status.
  const cwd = process.cwd();
  const secrets = await readEveSecrets(cwd);
  const synapUrl = await resolveSynapUrlOnHost(secrets);
  if (!synapUrl) {
    printWarning('skipped — synap not configured.');
    printInfo('Fix: re-run `eve install` or set domain.primary in secrets.json.');
    console.log();
    return;
  }
  printInfo(`Pod: ${colors.info(synapUrl)}`);
  console.log();

  const runner = buildRunner();
  for (const agent of AGENTS) {
    const cfg = await resolveAgentConfig(agent.agentType);
    if (!cfg) {
      console.log(
        `  ${colors.muted(emojis.warning)} ${agent.label.padEnd(22)} ${colors.muted('(no key — run `eve auth provision`)')}`,
      );
      continue;
    }
    const result = await getAuthStatus({
      synapUrl: cfg.synapUrl,
      apiKey: cfg.apiKey,
      runner,
    });
    if (result.ok) {
      const s = result.status;
      const userTag = s.userEmail ?? s.userId.slice(0, 8);
      console.log(
        `  ${colors.success(emojis.check)} ${agent.label.padEnd(22)} ${cfg.apiKeyPrefix}…  ${colors.muted(`${userTag}, ${s.scopes.length} scope${s.scopes.length === 1 ? '' : 's'}, ${s.ageDays}d old`)}`,
      );
    } else {
      console.log(
        `  ${colors.error(emojis.cross)} ${agent.label.padEnd(22)} ${cfg.apiKeyPrefix}…  ${colors.error(result.failure.reason)} — ${colors.muted(result.failure.message)}`,
      );
    }
  }
  console.log();
  printInfo(`Run \`eve auth status --agent <slug>\` for details, or \`eve auth renew --agent <slug>\` to fix.`);
  console.log();
}

async function renderAgentDetail(agent: AgentInfo): Promise<void> {
  const cfg = await resolveAgentConfig(agent.agentType);
  if (!cfg) {
    printInfo(`  Pod:       ${colors.muted('(checked secrets.json)')}`);
    printInfo(`  Key:       ${colors.muted('(none registered for this agent)')}`);
    console.log();
    printWarning(`No key for agent "${agent.agentType}".`);
    printInfo('Fix: `eve auth provision` (mints any missing agent keys).');
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
  console.log(`  ${colors.muted('Pod:'.padEnd(11))} ${colors.info(cfg.synapUrl)}  ${colors.muted('(resolved via domain config)')}`);
  console.log(`  ${colors.muted('Agent:'.padEnd(11))} ${cfg.agentType}  ${colors.muted(`(${agent.description})`)}`);
  console.log(`  ${colors.muted('Key:'.padEnd(11))} ${cfg.apiKeyPrefix}…  ${colors.muted('(prefix shown)')}`);

  if (result.ok) {
    renderActiveStatus(result.status);
  } else {
    renderFailure(result.failure, agent.agentType);
  }
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

function renderFailure(failure: AuthFailure, agentType: string): void {
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
      fix = `eve auth renew --agent ${agentType}`;
      break;
    case 'invalid_format':
      fix = `Re-run \`eve install\` or \`eve auth renew --agent ${agentType}\``;
      break;
    case 'no_auth':
      fix = `eve auth provision`;
      break;
    case 'missing_scope':
      fix = missingScope
        ? `Re-mint with required scopes (eve auth renew --agent ${agentType})`
        : `Re-mint with required scopes (eve auth renew --agent ${agentType})`;
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
// `eve auth whoami`
// ---------------------------------------------------------------------------

async function runWhoami(opts: { agent?: string }): Promise<void> {
  const agentType = opts.agent ?? 'eve';
  const cfg = await resolveAgentConfig(agentType);
  if (!cfg) {
    printError(
      `No key for agent "${agentType}". Run \`eve auth provision\` to mint missing keys.`,
    );
    process.exitCode = 1;
    return;
  }
  const result = await getAuthStatus({
    synapUrl: cfg.synapUrl,
    apiKey: cfg.apiKey,
    runner: buildRunner(),
  });
  if (!result.ok) {
    printError(`auth failed for ${agentType} (${result.failure.reason}): ${result.failure.message}`);
    process.exitCode = 1;
    return;
  }
  const s = result.status;
  const tag = s.userEmail ? `${s.userId.slice(0, 8)} <${s.userEmail}>` : s.userId.slice(0, 8);
  console.log(
    `${colors.success(emojis.check)} ${agentType} → ${tag}  ${colors.muted(`(${s.scopes.length} scope${s.scopes.length === 1 ? '' : 's'}, key age ${s.ageDays}d, prefix ${cfg.apiKeyPrefix}…)`)}`,
  );
}

// ---------------------------------------------------------------------------
// `eve auth renew` — re-mint one or all agent keys
// ---------------------------------------------------------------------------

interface RenewOptions {
  agent?: string;
  all?: boolean;
  /** Skip the auto-restart of openwebui-pipelines after a successful eve renew. */
  skipPipelinesRestart?: boolean;
}

async function runRenew(opts: RenewOptions): Promise<void> {
  console.log();
  printHeader('Synap auth renew');
  console.log();

  if (opts.all) {
    await runRenewAll();
    return;
  }

  const agentType = opts.agent ?? 'eve';
  const targeted = resolveAgent(agentType);
  if (!targeted) {
    printError(`Unknown agent: ${agentType}.`);
    printInfo(`Available: ${AGENTS.map((a) => a.agentType).join(', ')}`);
    process.exitCode = 1;
    return;
  }

  const cfg = await resolveAgentConfig(agentType);
  const previousPrefix = cfg?.apiKeyPrefix ?? '(none)';

  printInfo(`Agent:         ${agentType} (${targeted.label})`);
  if (cfg) {
    printInfo(`Pod:           ${cfg.synapUrl}`);
    printInfo(`Previous key:  ${previousPrefix}…`);
  } else {
    printInfo(`Pod:           ${colors.muted('(resolving from secrets…)')}`);
  }
  console.log();

  const spinner = createSpinner(`Calling POST /api/hub/setup/agent (agentType=${agentType})…`);
  spinner.start();
  const result = await renewAgentKey({
    deployDir: process.cwd(),
    agentType,
    reason: 'manual',
    runner: buildRunner(),
  });
  if (!result.renewed) {
    spinner.fail('Renew failed');
    printError(result.reason);
    console.log();
    printInfo(
      'Common causes:\n' +
        '  • PROVISIONING_TOKEN unavailable — set EVE_PROVISIONING_TOKEN=<token> and retry.\n' +
        "    The token lives in your synap-backend's deploy/.env on the pod host.\n" +
        '  • Backend version too old — run `eve update synap`.\n' +
        '  • Network: pod unreachable from this host (`eve doctor`).',
    );
    process.exitCode = 1;
    return;
  }
  spinner.succeed(`Renewed ${agentType} agent key — new prefix ${result.keyIdPrefix}…`);

  console.log();
  printSuccess(
    `Renewed ${agentType} agent key (was ${previousPrefix}…, now ${result.keyIdPrefix}…)`,
  );
  printInfo('  secrets.json updated atomically.');

  // Pipelines restart only matters when the eve agent was renewed —
  // its key mirrors back into the legacy `synap.apiKey` field that
  // older pipelines wiring reads. Renewing openclaw / hermes /
  // pipelines-the-agent doesn't change that field, so no restart needed.
  if (agentType === 'eve' && !opts.skipPipelinesRestart) {
    console.log();
    const rs = createSpinner('Restarting openwebui-pipelines to pick up the new key…');
    rs.start();
    try {
      const r = await runActionToCompletion('openwebui-pipelines', 'update');
      if (r.ok) {
        rs.succeed('openwebui-pipelines refreshed');
      } else {
        rs.warn('openwebui-pipelines not refreshed (component may not be installed)');
        if (r.error && !r.error.includes('No update path')) {
          printInfo(`  ${colors.muted(r.error)}`);
        }
      }
    } catch (err) {
      rs.warn('openwebui-pipelines refresh threw — restart manually if needed');
      printInfo(`  ${colors.muted(err instanceof Error ? err.message : String(err))}`);
    }
  } else if (agentType === 'eve' && opts.skipPipelinesRestart) {
    printInfo('Skipping pipelines restart (--no-pipelines-restart).');
    printInfo('  Run `eve update openwebui-pipelines` to apply the new key downstream.');
  }
  console.log();
}

async function runRenewAll(): Promise<void> {
  printInfo('Renewing every provisioned agent key…');
  console.log();

  const installed = await entityStateManager
    .getInstalledComponents()
    .catch(() => [] as string[]);

  const spinner = createSpinner(`Walking ${AGENTS.length} agents in registry order…`);
  spinner.start();
  const results = await provisionAllAgents({
    installedComponentIds: installed,
    deployDir: process.cwd(),
    reason: 'renew-all',
    skipIfPresent: false,
    runner: buildRunner(),
  });
  spinner.succeed(`Walked ${results.length} agents`);

  console.log();
  renderProvisionResults(results);
  console.log();

  const failures = results.filter((r) => !r.provisioned);
  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------------------
// `eve auth provision` — mint missing agent keys
// ---------------------------------------------------------------------------

async function runProvision(opts: { agent?: string; email?: string }): Promise<void> {
  console.log();
  printHeader('Synap auth provision');
  console.log();

  // ------------------------------------------------------------------
  // Preflight: auto-discover and configure every prerequisite so the
  // operator doesn't have to manually set up secrets.json, compose
  // overrides, or PROVISIONING_TOKEN before running this command.
  // ------------------------------------------------------------------
  const preflightSpinner = createSpinner('Checking prerequisites…');
  preflightSpinner.start();

  let synapUrl: string;
  let provisioningToken: string;
  try {
    const preflight = await runBackendPreflight({ cwd: process.cwd() });
    synapUrl = preflight.synapUrl;
    provisioningToken = preflight.provisioningToken;
    if (preflight.configured || preflight.notes.length > 0) {
      preflightSpinner.succeed('Prerequisites ready (auto-configured)');
      for (const note of preflight.notes) {
        printInfo(`  ${note}`);
      }
      console.log();
    } else {
      preflightSpinner.succeed('Prerequisites ready');
    }
  } catch (err) {
    preflightSpinner.fail('Preflight failed');
    printError(err instanceof Error ? err.message : String(err));
    console.log();
    printInfo('Run `eve setup` to initialise Eve on this server from scratch.');
    process.exitCode = 1;
    return;
  }

  // ------------------------------------------------------------------
  // Ensure Kratos is running — it may never have been started on older
  // installs or when the backend was started independently of eve install.
  // We print plain output here (no spinner) so docker compose logs are
  // visible to the operator.
  // ------------------------------------------------------------------
  try {
    const secrets = await readEveSecrets(process.cwd());
    const domain = secrets?.domain?.primary ?? 'localhost';
    const deployDir = findPodDeployDir() ?? '/opt/synap-backend';
    printInfo(`Ensuring Kratos is running (deploy dir: ${deployDir})…`);
    await ensureKratosRunning(deployDir, domain);
    printSuccess('Kratos ready');
  } catch (err) {
    // Non-fatal — log and continue; createAdminUser will give a clear error if kratos is still down
    printWarning(`Could not ensure Kratos: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ------------------------------------------------------------------
  // Check if the pod has a first admin yet. If not, run setup-admin
  // inline so provision has a workspace to associate agents with.
  // ------------------------------------------------------------------
  const needsSetup = await checkNeedsAdmin(synapUrl, provisioningToken);
  if (needsSetup) {
    printWarning('No admin account found on this pod.');
    printInfo('Running first-admin setup before provisioning agent keys…');
    console.log();

    const secrets = await readEveSecrets(process.cwd());
    const domain = secrets?.domain?.primary;
    const publicUrl = domain ? `https://pod.${domain}` : undefined;

    const mode = opts.email ? 'prompt' : 'magic-link';
    await runSetupAdminInline({ synapUrl, provisioningToken, mode, email: opts.email, publicUrl });
    console.log();
  }

  if (opts.agent) {
    const targeted = resolveAgent(opts.agent);
    if (!targeted) {
      printError(`Unknown agent: ${opts.agent}.`);
      printInfo(`Available: ${AGENTS.map((a) => a.agentType).join(', ')}`);
      process.exitCode = 1;
      return;
    }
    const spinner = createSpinner(`Provisioning ${opts.agent}…`);
    spinner.start();
    const result = await provisionAgent({
      agentType: opts.agent,
      deployDir: process.cwd(),
      reason: 'manual-provision',
      runner: buildRunner(),
      synapUrl,
      provisioningToken,
    });
    if (result.provisioned) {
      spinner.succeed(`Provisioned ${opts.agent} (key prefix ${result.keyIdPrefix}…)`);
    } else {
      spinner.fail(`Provision failed: ${result.reason}`);
      process.exitCode = 1;
    }
    console.log();
    return;
  }

  const installed = await entityStateManager
    .getInstalledComponents()
    .catch(() => [] as string[]);

  const spinner = createSpinner('Provisioning every installed agent…');
  spinner.start();
  const results = await provisionAllAgents({
    installedComponentIds: installed,
    deployDir: process.cwd(),
    reason: 'manual-provision',
    skipIfPresent: true,
    runner: buildRunner(),
    synapUrl,
    provisioningToken,
  });
  spinner.succeed(`Walked ${results.length} agent${results.length === 1 ? '' : 's'}`);

  console.log();
  renderProvisionResults(results);
  console.log();

  const failures = results.filter((r) => !r.provisioned);
  if (failures.length > 0) {
    printWarning(
      `${failures.length} agent${failures.length === 1 ? '' : 's'} failed to provision — see reasons above.`,
    );
    // Surface the actionable hint that matches the actual failure pattern.
    const allOld = failures.every((r) => r.reason.includes('backend version too old'));
    const allToken = failures.every((r) =>
      r.reason.includes('PROVISIONING_TOKEN') || r.reason.includes('401') || r.reason.includes('403'),
    );
    if (allOld) {
      printInfo('Fix: run `eve update synap` to update the backend, then retry `eve auth provision`.');
    } else if (allToken) {
      printInfo('Fix: ensure PROVISIONING_TOKEN is set in /opt/synap-backend/.env, then retry.');
    } else {
      printInfo('Common causes:');
      printInfo('  • Backend outdated → `eve update synap`');
      printInfo('  • PROVISIONING_TOKEN missing → check /opt/synap-backend/.env');
      printInfo('  • Backend unreachable → `eve doctor`');
    }
    process.exitCode = 1;
  } else {
    printSuccess('All agents provisioned.');
  }
}

function renderProvisionResults(results: ProvisionResult[]): void {
  for (const r of results) {
    if (r.provisioned) {
      console.log(
        `  ${colors.success(emojis.check)} ${r.agentType.padEnd(22)} ${r.keyIdPrefix}…  ${colors.muted(`(user ${r.record.agentUserId.slice(0, 8)}, ws ${r.record.workspaceId.slice(0, 8)})`)}`,
      );
    } else {
      console.log(
        `  ${colors.error(emojis.cross)} ${r.agentType.padEnd(22)} ${colors.error('failed')}  ${colors.muted(r.reason)}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function authCommand(program: Command): void {
  const auth = program
    .command('auth')
    .description(`${emojis.sparkles} Inspect, validate, and renew per-agent Synap API keys`);

  auth
    .command('status')
    .description(
      'Show current key state for every agent (or one with --agent). ' +
        'Lists prefix, user, scopes, age, and any failure reason.',
    )
    .option(
      '--agent <slug>',
      'Restrict to one agent (eve, openclaw, hermes, openwebui-pipelines, coder).',
    )
    .action(async (opts: StatusOptions) => {
      try {
        await runStatus(opts);
      } catch (err) {
        printError(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      }
    });

  auth
    .command('whoami')
    .description('Tight one-liner — user, scopes count, key prefix.')
    .option('--agent <slug>', 'Which agent to introspect. Defaults to "eve".')
    .action(async (opts: { agent?: string }) => {
      try {
        await runWhoami(opts);
      } catch (err) {
        printError(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      }
    });

  auth
    .command('renew')
    .description(
      'Re-mint an agent API key via POST /api/hub/setup/agent and atomically update secrets.json.',
    )
    .option('--agent <slug>', 'Which agent to renew. Defaults to "eve".')
    .option('--all', 'Renew every registered agent key in registry order.')
    .option(
      '--no-pipelines-restart',
      'Skip the auto-restart of openwebui-pipelines after a successful eve renew.',
    )
    .action(async (opts: { agent?: string; all?: boolean; pipelinesRestart?: boolean }) => {
      // Commander turns `--no-pipelines-restart` into `pipelinesRestart: false`.
      const skipPipelinesRestart = opts.pipelinesRestart === false;
      try {
        await runRenew({ agent: opts.agent, all: opts.all, skipPipelinesRestart });
      } catch (err) {
        printError(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      }
    });

  auth
    .command('provision')
    .description(
      'Mint missing agent keys for every installed component (and the always-on eve agent). ' +
        'Idempotent — skips agents that already have a key. ' +
        'If no admin account exists yet, runs first-admin setup automatically.',
    )
    .option('--agent <slug>', 'Provision a specific agent only.')
    .option(
      '--email <email>',
      'Admin email for first-admin setup (prompt mode). Omit to use magic-link mode.',
    )
    .action(async (opts: { agent?: string; email?: string }) => {
      try {
        await runProvision(opts);
      } catch (err) {
        printError(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      }
    });

  auth
    .command('bootstrap-token')
    .description(
      'Ensure the pod has a working PROVISIONING_TOKEN. Generates one if ' +
        'missing/empty, writes it to the pod\'s deploy/.env, and restarts ' +
        'the backend so it loads the new value. Idempotent — a no-op if a ' +
        'real token already exists.',
    )
    .action(async () => {
      console.log();
      printHeader('Synap PROVISIONING_TOKEN bootstrap');
      console.log();
      const spinner = createSpinner('Resolving pod state…');
      spinner.start();
      try {
        const result = await ensurePodProvisioningToken();
        if (result.source === 'existing') {
          spinner.succeed('PROVISIONING_TOKEN already set — no change');
          printInfo(`Run \`eve auth provision\` to mint agent keys.`);
        } else {
          spinner.succeed(
            `Generated PROVISIONING_TOKEN and wrote it to ${result.writtenTo ?? '<pod>/.env'}`,
          );
          if (result.backendRestarted) {
            printInfo('Backend restarted — agent provisioning is now unblocked.');
            printInfo('Next: `eve auth provision`');
          } else {
            printWarning(
              'Backend was not restarted (compose unavailable). The token is on disk; ' +
                'restart synap-backend manually then run `eve auth provision`.',
            );
          }
        }
      } catch (err) {
        spinner.fail(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      }
      console.log();
    });
}
