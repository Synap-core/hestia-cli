/**
 * `eve mode` — toggle stack-wide modes that touch more than one
 * component. Today: `multi-user`. Each mode flips a coordinated set of
 * env vars across two or more `.env` files and recreates the affected
 * containers via `@eve/lifecycle` so we don't reinvent `compose up`.
 *
 * Why this exists: synap-backend just shipped per-user sub-tokens
 * (HUB_PROTOCOL_SUB_TOKENS=true) and openwebui-pipelines started
 * honoring SYNAP_PER_USER_TOKENS=1 on the same release. The two flags
 * MUST move together — leaving one ON and one OFF gives a broken state
 * (pipeline mints sub-tokens that backend rejects, or backend issues
 * sub-tokens nobody uses). Editing two `.env` files by hand and
 * remembering to recreate two containers is a footgun, so we wrap it.
 *
 * Design notes:
 *  - Idempotent: `on`/`off` skip the recreate step when both flags
 *    already match the requested state. `eve mode multi-user on`
 *    twice never spuriously bounces traffic.
 *  - Atomic env writes via `@eve/lifecycle/writeEnvVar` so Ctrl-C
 *    can't leave a half-written file.
 *  - Container state-of-the-world reported by cross-checking the
 *    `.env` file against `docker inspect` — drift means the file says
 *    one thing but the running container has a different env (last
 *    install was before the flag, or someone restarted instead of
 *    `compose up -d` after editing). Status flags this loudly.
 *  - Missing-component graceful: if openwebui-pipelines isn't
 *    installed, flipping multi-user still updates the synap side and
 *    warns. Symmetric for synap.
 *  - We never call `docker` directly — recreate goes through
 *    `runActionToCompletion(id, 'update')`, the same lifecycle path
 *    `eve update` uses. Compose-based components run `compose up -d`,
 *    which IS what re-reads the `.env` file. So the existing recreate
 *    path already does the right thing for our env-file changes; no
 *    new lifecycle hook needed.
 */

import { Command } from 'commander';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  runActionToCompletion,
  readEnvVar,
  writeEnvVar,
  reconcileOpenclawConfig,
} from '@eve/lifecycle';
import { entityStateManager, readEveSecrets } from '@eve/dna';
import {
  colors,
  printInfo,
  printSuccess,
  printWarning,
  printError,
  createSpinner,
  emojis,
} from '../lib/ui.js';

// ── multi-user mode definition ────────────────────────────────────────────────

type Strategy = 'first' | 'all' | 'none';
const STRATEGIES: readonly Strategy[] = ['first', 'all', 'none'] as const;
const DEFAULT_STRATEGY: Strategy = 'first';

interface ComponentSlot {
  /** Lifecycle component id (matches @eve/dna COMPONENTS). */
  id: string;
  /** User-facing label for printouts. */
  label: string;
  /** Resolved deploy dir holding the `.env` file. */
  resolveDeployDir: () => string | null;
  /** Container name to introspect for drift detection. */
  containerName: string;
  /** Env keys this slot owns for the multi-user flag. */
  flagKey: string;
  flagOn: string;
  flagOff: string;
  /** Optional secondary keys (e.g. strategy on synap). */
  extras?: ReadonlyArray<{ key: string; on: string; off: string | null }>;
}

function resolveSynapDeployDir(): string | null {
  const candidates = [process.env.SYNAP_DEPLOY_DIR, '/opt/synap-backend/deploy'];
  for (const d of candidates) {
    if (d && existsSync(join(d, 'docker-compose.yml'))) return d;
  }
  return null;
}

function resolvePipelinesDeployDir(): string | null {
  const dir = '/opt/openwebui-pipelines';
  return existsSync(join(dir, 'docker-compose.yml')) ? dir : null;
}

/**
 * Build the slot list for a given strategy. The strategy only affects
 * the synap-backend slot's `extras` (HUB_PROTOCOL_EXTERNAL_USER_WORKSPACE_STRATEGY).
 */
function multiUserSlots(strategy: Strategy): ComponentSlot[] {
  return [
    {
      id: 'synap',
      label: '🧠 synap-backend',
      resolveDeployDir: resolveSynapDeployDir,
      containerName: 'synap-backend-backend-1',
      flagKey: 'HUB_PROTOCOL_SUB_TOKENS',
      flagOn: 'true',
      flagOff: 'false',
      extras: [
        {
          key: 'HUB_PROTOCOL_EXTERNAL_USER_WORKSPACE_STRATEGY',
          on: strategy,
          // When turning multi-user OFF we drop the strategy line so the
          // backend falls back to its compiled default and the file stays
          // tidy.
          off: null,
        },
      ],
    },
    {
      id: 'openwebui-pipelines',
      label: '🪈 openwebui-pipelines',
      resolveDeployDir: resolvePipelinesDeployDir,
      containerName: 'eve-openwebui-pipelines',
      flagKey: 'SYNAP_PER_USER_TOKENS',
      flagOn: '1',
      flagOff: '0',
    },
  ];
}

interface SlotState {
  installed: boolean;
  deployDir: string | null;
  fileFlag: string | null;
  fileExtras: Record<string, string | null>;
  containerFlag: string | null;
  /** True if file says ON for the primary flag. */
  fileOn: boolean;
  /** True if container says ON for the primary flag (null = container missing). */
  containerOn: boolean | null;
  /** File and container disagree (drift). */
  drift: boolean;
}

async function getInstalledIds(): Promise<Set<string>> {
  try {
    return new Set(await entityStateManager.getInstalledComponents());
  } catch {
    // state.json absent / unreadable — fall back to "everything is
    // installed and let the deploy-dir check decide". Better than
    // refusing to operate on a fresh server.
    return new Set(['synap', 'openwebui-pipelines']);
  }
}

/**
 * Read a single env var off a running container via `docker inspect`.
 * Returns null when the container isn't running, has no such env, or
 * docker isn't reachable. Quiet on failure — drift detection is a
 * nice-to-have.
 */
function readContainerEnv(containerName: string, key: string): string | null {
  try {
    // Go template walks the env array and prints `KEY=VALUE` for our
    // match. Index format keeps it on one stdout line.
    const out = execSync(
      `docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' ${containerName}`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] },
    );
    for (const line of out.split('\n')) {
      const eq = line.indexOf('=');
      if (eq < 0) continue;
      if (line.slice(0, eq) === key) return line.slice(eq + 1);
    }
    return null;
  } catch {
    return null;
  }
}

async function probeSlot(
  slot: ComponentSlot,
  installedIds: Set<string>,
): Promise<SlotState> {
  const deployDir = slot.resolveDeployDir();
  // "Installed" here means "the lifecycle thinks it's there OR the
  // deploy dir exists on disk". State.json can lag; the deploy dir is
  // ground truth for whether `.env` writes will actually do anything.
  const installed = installedIds.has(slot.id) || !!deployDir;

  if (!installed || !deployDir) {
    return {
      installed: false,
      deployDir,
      fileFlag: null,
      fileExtras: {},
      containerFlag: null,
      fileOn: false,
      containerOn: null,
      drift: false,
    };
  }

  const fileFlag = readEnvVar(deployDir, slot.flagKey);
  const fileExtras: Record<string, string | null> = {};
  for (const e of slot.extras ?? []) {
    fileExtras[e.key] = readEnvVar(deployDir, e.key);
  }
  const containerFlag = readContainerEnv(slot.containerName, slot.flagKey);

  const fileOn = isTruthy(fileFlag);
  const containerOn = containerFlag === null ? null : isTruthy(containerFlag);
  const drift = containerOn !== null && containerOn !== fileOn;

  return {
    installed: true,
    deployDir,
    fileFlag,
    fileExtras,
    containerFlag,
    fileOn,
    containerOn,
    drift,
  };
}

/** Coerce a stringy env value to boolean. Mirrors backend + pipelines parse. */
function isTruthy(value: string | null): boolean {
  if (value === null) return false;
  const v = value.trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'yes' || v === 'on';
}

function fmtState(on: boolean | null): string {
  if (on === null) return colors.muted('—');
  return on ? colors.success('ON') : colors.muted('OFF');
}

// ── command actions ──────────────────────────────────────────────────────────

interface ActionOpts {
  strategy?: Strategy;
}

async function modeStatus(strategy: Strategy): Promise<void> {
  const installed = await getInstalledIds();
  const slots = multiUserSlots(strategy);
  const states = await Promise.all(slots.map(s => probeSlot(s, installed)));

  console.log();
  console.log(colors.primary.bold('Eve Mode — multi-user'));
  console.log(colors.muted('─'.repeat(50)));

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    const st = states[i];

    if (!st.installed) {
      console.log(`  ${slot.label}: ${colors.muted('not installed')}`);
      continue;
    }

    const fileLine = `${slot.flagKey}=${st.fileFlag ?? colors.muted('(unset)')}`;
    const ctrLine = st.containerFlag === null
      ? colors.muted('(container not running)')
      : `${slot.flagKey}=${st.containerFlag}`;

    console.log(
      `  ${slot.label}: file=${fmtState(st.fileOn)} container=${fmtState(st.containerOn)}`,
    );
    console.log(`    ${colors.muted('.env:')}       ${fileLine}`);
    console.log(`    ${colors.muted('inspect:')}    ${ctrLine}`);

    for (const e of slot.extras ?? []) {
      const v = st.fileExtras[e.key];
      console.log(`    ${colors.muted('.env:')}       ${e.key}=${v ?? colors.muted('(unset)')}`);
    }

    if (st.drift) {
      printWarning(
        `  ${slot.label}: .env says ${st.fileOn ? 'ON' : 'OFF'} but the running container has it ${st.containerOn ? 'ON' : 'OFF'}. Run \`eve mode multi-user ${st.fileOn ? 'on' : 'off'}\` (or \`eve update ${slot.id}\`) to reconcile.`,
      );
    }
  }

  // Cross-component coherence check. Both must be ON or both OFF.
  const installedStates = states.filter(s => s.installed);
  if (installedStates.length === 2) {
    const [a, b] = installedStates;
    if (a.fileOn !== b.fileOn) {
      console.log();
      printWarning(
        'Multi-user flags disagree: one component is ON and the other is OFF. ' +
        'Sub-token issuance and consumption MUST move together. ' +
        'Run `eve mode multi-user on` (or `off`) to bring them back in sync.',
      );
    }
  }

  console.log();
}

interface SetResult {
  slotId: string;
  changed: boolean;
  /** True if we updated the file or extras (i.e. need a restart). */
  fileTouched: boolean;
}

function applyDesiredState(
  slot: ComponentSlot,
  state: SlotState,
  desired: boolean,
): SetResult {
  if (!state.installed || !state.deployDir) {
    return { slotId: slot.id, changed: false, fileTouched: false };
  }

  let touched = false;
  let changed = false;

  const want = desired ? slot.flagOn : slot.flagOff;
  const r = writeEnvVar(state.deployDir, slot.flagKey, want);
  if (r.changed) {
    touched = true;
    changed = true;
  }

  for (const e of slot.extras ?? []) {
    const targetValue = desired ? e.on : e.off;
    const er = writeEnvVar(state.deployDir, e.key, targetValue);
    if (er.changed) touched = true;
  }

  // Drift forces a recreate even if the file matched. Without this,
  // `mode multi-user on` against a system whose container env is stale
  // would falsely report success.
  if (state.drift) touched = true;

  return { slotId: slot.id, changed, fileTouched: touched };
}

async function modeSet(desired: boolean, opts: ActionOpts): Promise<void> {
  const strategy = opts.strategy ?? DEFAULT_STRATEGY;
  const installed = await getInstalledIds();
  const slots = multiUserSlots(strategy);
  const states = await Promise.all(slots.map(s => probeSlot(s, installed)));

  // Warn upfront if a component is missing — proceed anyway with the
  // ones that are installed.
  const installedSlots: { slot: ComponentSlot; state: SlotState }[] = [];
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    const st = states[i];
    if (!st.installed) {
      printWarning(`${slot.label} is not installed — skipping (the other component will still be updated).`);
    } else {
      installedSlots.push({ slot, state: st });
    }
  }

  if (installedSlots.length === 0) {
    printError('Neither component is installed. Nothing to do.');
    process.exitCode = 1;
    return;
  }

  console.log();
  console.log(colors.primary.bold(`Eve Mode — multi-user ${desired ? 'on' : 'off'}`));
  console.log(colors.muted('─'.repeat(50)));

  // Step 1: update env files atomically.
  const writes: SetResult[] = [];
  for (const { slot, state } of installedSlots) {
    const r = applyDesiredState(slot, state, desired);
    writes.push(r);
    if (r.changed) {
      const verb = desired ? 'enabled' : 'disabled';
      printInfo(`${slot.label}: ${slot.flagKey} ${verb} (was ${state.fileFlag ?? 'unset'})`);
    } else if (r.fileTouched) {
      // Strategy changed but primary flag didn't — surface it so the
      // user understands why we still recreate.
      printInfo(`${slot.label}: extras updated, primary flag already ${desired ? 'ON' : 'OFF'}`);
    } else {
      printInfo(`${slot.label}: already ${desired ? 'ON' : 'OFF'} — no file change`);
    }
  }

  // Step 2: recreate containers whose env changed (or whose container
  // drifted from the file). Idempotent — no-op when nothing was touched.
  const toRecreate = writes.filter(w => w.fileTouched);
  if (toRecreate.length === 0) {
    console.log();
    printSuccess(`Already ${desired ? 'ON' : 'OFF'} — no containers needed to restart.`);
    console.log();
    return;
  }

  for (const w of toRecreate) {
    const slot = installedSlots.find(s => s.slot.id === w.slotId)!.slot;
    const spinner = createSpinner(`Recreating ${slot.label} to apply env changes...`);
    spinner.start();
    try {
      // `update` runs `compose up -d` for compose-based components, which
      // re-reads the .env file. Same path `eve update` uses — single
      // source of truth for the recreate orchestration.
      const result = await runActionToCompletion(slot.id, 'update');
      if (!result.ok) {
        const tail = result.logs.slice(-4).join('\n');
        spinner.fail(`${slot.label} — recreate failed (${result.error ?? 'unknown'})`);
        if (tail) {
          for (const line of tail.split('\n')) {
            console.log(`  ${colors.muted('│')} ${line.trim()}`);
          }
        }
        process.exitCode = 1;
      } else {
        spinner.succeed(`${slot.label} restarted with new env`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      spinner.fail(`${slot.label} — recreate threw (${msg})`);
      process.exitCode = 1;
    }
  }

  // Step 3: re-probe and print a concise summary of effective state so
  // the user doesn't need to run `status` after every flip.
  console.log();
  const finalStates = await Promise.all(installedSlots.map(({ slot }) =>
    probeSlot(slot, installed),
  ));
  console.log(colors.primary.bold('Effective state'));
  for (let i = 0; i < installedSlots.length; i++) {
    const { slot } = installedSlots[i];
    const st = finalStates[i];
    console.log(
      `  ${slot.label}: file=${fmtState(st.fileOn)} container=${fmtState(st.containerOn)}`,
    );
    if (st.drift) {
      printWarning(`  ${slot.label} still drifted — file and container disagree. Investigate.`);
    }
  }
  console.log();
  printSuccess(`Multi-user mode is now ${desired ? colors.success('ON') : colors.muted('OFF')}.`);
  console.log();
}

async function modeStrategy(strategy: Strategy): Promise<void> {
  // Bare `--strategy` only makes sense for synap-backend (the routing
  // is backend-side). Pipelines doesn't have a strategy knob. So this
  // is a focused operation: write the strategy to synap's .env and
  // recreate ONLY when multi-user is currently ON (otherwise the value
  // sits dormant — perfectly fine, no restart).
  const installed = await getInstalledIds();
  const synapSlot = multiUserSlots(strategy)[0]; // index 0 = synap
  const state = await probeSlot(synapSlot, installed);

  if (!state.installed || !state.deployDir) {
    printError('synap-backend is not installed — cannot set strategy.');
    process.exitCode = 1;
    return;
  }

  const extras = synapSlot.extras ?? [];
  let touched = false;
  for (const e of extras) {
    const targetValue = state.fileOn ? e.on : e.off;
    const r = writeEnvVar(state.deployDir, e.key, targetValue);
    if (r.changed) {
      touched = true;
      printInfo(
        `${synapSlot.label}: ${e.key} = ${targetValue ?? '(removed)'} (was ${r.previous ?? 'unset'})`,
      );
    } else {
      printInfo(`${synapSlot.label}: ${e.key} already at desired value`);
    }
  }

  if (touched && state.fileOn) {
    const spinner = createSpinner(`Recreating ${synapSlot.label} to apply strategy change...`);
    spinner.start();
    try {
      const result = await runActionToCompletion(synapSlot.id, 'update');
      if (!result.ok) {
        spinner.fail(`${synapSlot.label} — recreate failed (${result.error ?? 'unknown'})`);
        process.exitCode = 1;
      } else {
        spinner.succeed(`${synapSlot.label} restarted with new strategy`);
      }
    } catch (err) {
      spinner.fail(`${synapSlot.label} — recreate threw (${err instanceof Error ? err.message : String(err)})`);
      process.exitCode = 1;
    }
  } else if (touched) {
    printInfo(
      'Multi-user is currently OFF — strategy stored in .env but not applied to the container (no recreate). It will take effect next time you run `eve mode multi-user on`.',
    );
  } else {
    printInfo('No changes — strategy is already where you want it.');
  }
}

// ── reconcile-openclaw action ────────────────────────────────────────────────

interface ReconcileOpenclawOpts {
  /** Override the public domain. When undefined, falls back to secrets. */
  domain?: string;
  containerName?: string;
  configPath?: string;
  /** Restart the container if the file changed. Default true. */
  restart: boolean;
}

/**
 * One-shot reconciliation runner for `eve mode reconcile-openclaw`. The
 * heavy lifting lives in `@eve/lifecycle`'s `reconcileOpenclawConfig`; this
 * wrapper just resolves the domain from secrets when the user didn't pass
 * `--domain`, prints the structured result, and (optionally) restarts.
 *
 * Exits non-zero only on hard read/write failures inside the reconcile —
 * the no-op paths (container down, no domain configured) are reported as
 * INFO and exit clean. They're "nothing to do", not errors.
 */
async function runReconcileOpenclaw(opts: ReconcileOpenclawOpts): Promise<void> {
  // Resolve the domain. Explicit --domain wins; otherwise pull from secrets.
  // No domain at all is fine — the reconcile still merges localhost
  // origins and surfaces a note about the public side being skipped.
  let domain = opts.domain;
  if (!domain) {
    try {
      const secrets = await readEveSecrets();
      domain = secrets?.domain?.primary;
    } catch {
      // secrets.json missing/unreadable — proceed with no domain. The
      // reconcile fn already handles this path gracefully.
    }
  }

  console.log();
  console.log(colors.primary.bold('Eve Mode — reconcile-openclaw'));
  console.log(colors.muted('─'.repeat(50)));
  if (domain) {
    printInfo(`Public domain: ${domain} → https://openclaw.${stripScheme(domain)}`);
  } else {
    printInfo('No public domain configured — only localhost origins will be reconciled.');
  }

  const spinner = createSpinner('Reading OpenClaw config…');
  spinner.start();

  let result;
  try {
    result = await reconcileOpenclawConfig({
      domain,
      containerName: opts.containerName,
      configPath: opts.configPath,
    });
  } catch (err) {
    spinner.fail('reconcile threw');
    printError(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
    return;
  }

  if (result.changed) {
    spinner.succeed('OpenClaw config updated');
  } else {
    spinner.succeed('OpenClaw config already in sync');
  }

  // Always print the notes — they describe the no-op cases (container
  // down, no domain) and the change description on the active path.
  for (const n of result.notes) {
    console.log(`  ${colors.muted('↳')} ${n}`);
  }

  // Diff hint on the change path so the user can verify what landed.
  if (result.changed) {
    console.log();
    console.log(`  ${colors.muted('before:')} ${formatOriginList(result.before.allowedOrigins)}`);
    console.log(`  ${colors.muted('after: ')} ${formatOriginList(result.after.allowedOrigins)}`);
  }

  // Restart only when something actually changed AND the caller wants it.
  // The lifecycle's post-update hook does this automatically; this is the
  // explicit-CLI mirror.
  if (result.changed && opts.restart) {
    console.log();
    const rs = createSpinner(`Restarting ${opts.containerName ?? 'eve-arms-openclaw'} to apply…`);
    rs.start();
    try {
      execSync(`docker restart ${opts.containerName ?? 'eve-arms-openclaw'}`, {
        stdio: 'ignore',
        timeout: 15000,
      });
      rs.succeed('Container restarted');
    } catch (err) {
      rs.fail('docker restart failed');
      printWarning(err instanceof Error ? err.message : String(err));
      // Soft-fail: the file is correct, but the running process still has
      // the stale list. Tell the user the next step rather than throwing.
      printInfo(`Run \`docker restart ${opts.containerName ?? 'eve-arms-openclaw'}\` manually to apply.`);
      process.exitCode = 1;
      return;
    }
  } else if (result.changed && !opts.restart) {
    printInfo('--no-restart was set; the new origins will take effect on the next OpenClaw restart.');
  }

  console.log();
  if (result.changed) {
    printSuccess('Reconciliation complete.');
  } else {
    printSuccess('Nothing to do.');
  }
  console.log();
}

function stripScheme(host: string): string {
  return host
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '');
}

function formatOriginList(origins: string[]): string {
  if (origins.length === 0) return colors.muted('(empty)');
  return origins.map(o => colors.primary(o)).join(', ');
}

// ── command registration ─────────────────────────────────────────────────────

export function modeCommands(program: Command): void {
  const mode = program.command('mode').description(`${emojis.sparkles} Toggle stack-wide modes (multi-user, reconcile-openclaw…)`);

  // ── reconcile-openclaw — one-shot config drift repair ─────────────────
  //
  // OpenClaw resets `gateway.controlUi.allowedOrigins` to localhost-only
  // every time it regenerates its auth token (e.g. after `eve update`,
  // image rebuild, or volume restore). The post-update lifecycle hook
  // already does this automatically, but we also expose it manually for:
  //   - older installs that pre-date the self-heal hook
  //   - drift after manual restarts that bypassed the lifecycle
  //   - new public domains where the user wants to push the config without
  //     redoing the full update cycle
  //
  // Idempotent — running it twice with no input changes leaves the file
  // alone the second time and reports `already in sync`.
  mode
    .command('reconcile-openclaw')
    .description('Re-add Eve\'s expected entries to OpenClaw\'s gateway.controlUi.allowedOrigins (idempotent).')
    .option('--domain <host>', 'Public domain to allow (default: secrets.domain.primary)')
    .option('--container <name>', 'OpenClaw container name', 'eve-arms-openclaw')
    .option('--config-path <path>', 'In-container path to openclaw.json', '/home/node/.openclaw/openclaw.json')
    .option('--no-restart', 'Skip the docker restart even when the file changed')
    .action(async (opts: {
      domain?: string;
      container?: string;
      configPath?: string;
      restart?: boolean;
    }) => {
      await runReconcileOpenclaw({
        domain: opts.domain,
        containerName: opts.container,
        configPath: opts.configPath,
        // Commander turns `--no-restart` into `restart: false`; default true.
        restart: opts.restart !== false,
      });
    });

  const mu = mode
    .command('multi-user')
    .description('Toggle per-user sub-tokens (HUB_PROTOCOL_SUB_TOKENS + SYNAP_PER_USER_TOKENS) across synap-backend and openwebui-pipelines.');

  mu.command('on')
    .description('Enable per-user sub-tokens on both components and recreate as needed.')
    .option('--strategy <strategy>', `Workspace assignment strategy (${STRATEGIES.join('|')})`, DEFAULT_STRATEGY)
    .action(async (opts: { strategy?: string }) => {
      const strategy = parseStrategy(opts.strategy);
      if (!strategy) return;
      await modeSet(true, { strategy });
    });

  mu.command('off')
    .description('Disable per-user sub-tokens on both components and recreate as needed.')
    .action(async () => {
      await modeSet(false, {});
    });

  mu.command('status')
    .description('Report multi-user mode state across components (file vs running container).')
    .action(async () => {
      // For status we only read; strategy default doesn't matter.
      await modeStatus(DEFAULT_STRATEGY);
    });

  // Allow `eve mode multi-user --strategy <s>` as a top-level form for
  // ergonomics — sets the synap strategy without flipping the mode.
  // Intentionally NOT mounted as a sub-command so the trio (on/off/status)
  // stays the primary surface in --help.
  mu.option('--strategy <strategy>', `Set HUB_PROTOCOL_EXTERNAL_USER_WORKSPACE_STRATEGY (${STRATEGIES.join('|')})`)
    .action(async (opts: { strategy?: string }) => {
      // Only fires when no sub-command (on/off/status) matched. Without
      // a flag, fall through to status to give the user something useful.
      if (!opts.strategy) {
        await modeStatus(DEFAULT_STRATEGY);
        return;
      }
      const s = parseStrategy(opts.strategy);
      if (!s) return;
      await modeStrategy(s);
    });
}

function parseStrategy(input: string | undefined): Strategy | null {
  if (!input) return DEFAULT_STRATEGY;
  if ((STRATEGIES as readonly string[]).includes(input)) return input as Strategy;
  printError(`Invalid strategy "${input}". Expected one of: ${STRATEGIES.join(', ')}`);
  process.exitCode = 1;
  return null;
}
