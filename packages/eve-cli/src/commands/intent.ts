/**
 * `eve intent` — record and manage overnight intents.
 *
 * An "intent" is a row in `background_tasks` (Hub Protocol REST) that the
 * Hermes daemon polls and dispatches when due. The CLI wraps the Hub
 * Protocol surface so the user can work in plain natural language:
 *
 *   eve intent add "research synap kanban patterns" --action coder.research
 *   eve intent list
 *   eve intent show <id>
 *   eve intent pause <id>
 *   eve intent resume <id>
 *   eve intent remove <id>
 *   eve intent run <id>     # force-run on the next poll cycle
 *
 * Pre-flight: `--action` is validated locally against the mirrored
 * registry from @eve/dna so typos fail fast. The pod is the authoritative
 * validator — when a brand-new action ships server-side but Eve hasn't
 * been updated yet, this CLI surfaces a clear "update Eve" hint via the
 * 400 envelope's `validActions` field.
 */

import { Command } from 'commander';
import Table from 'cli-table3';
import {
  EVE_BACKGROUND_ACTIONS,
  isValidEveBackgroundAction,
  listEveBackgroundActions,
  type BackgroundTask,
  type BackgroundTaskStatus,
  type BackgroundTaskType,
} from '@eve/dna';
import {
  BackgroundIntentError,
  getIntent,
  listIntents,
  pauseIntent,
  recordIntent,
  removeIntent,
  resumeIntent,
  updateIntent,
} from '@eve/builder';
import {
  colors,
  emojis,
  printError,
  printHeader,
  printInfo,
  printSuccess,
  printWarning,
} from '../lib/ui.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

interface CommonOptions {
  /** Override pod URL — useful for tests / non-default deployments. */
  podUrl?: string;
}

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

function formatNullable(v: string | null | undefined, fallback = '—'): string {
  if (!v) return fallback;
  return v;
}

function formatNextRun(row: BackgroundTask): string {
  if (!row.nextRunAt) return '—';
  const at = Date.parse(row.nextRunAt);
  if (Number.isNaN(at)) return row.nextRunAt;
  const delta = at - Date.now();
  if (delta <= 0) return colors.warning('due');
  if (delta < 60_000) return `<1m`;
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)}m`;
  if (delta < 86_400_000) return `${Math.round(delta / 3_600_000)}h`;
  return `${Math.round(delta / 86_400_000)}d`;
}

function formatStatus(s: BackgroundTaskStatus): string {
  if (s === 'active') return colors.success(s);
  if (s === 'paused') return colors.muted(s);
  return colors.error(s);
}

/**
 * Map a free-text prompt into a stable `name`. Strip leading verbs,
 * truncate at 60 chars, never emit empty strings.
 */
function deriveName(prompt: string): string {
  const cleaned = prompt.trim().replace(/\s+/g, ' ');
  if (!cleaned) return 'untitled intent';
  const truncated = cleaned.length > 60 ? cleaned.slice(0, 57).trimEnd() + '…' : cleaned;
  return truncated;
}

/**
 * Centralised error renderer. Maps every BackgroundIntentError kind to a
 * concrete fix hint so the operator never has to grep this file to find
 * out what `unauthorized` means.
 */
function renderIntentError(err: unknown, contextHint?: string): void {
  if (!(err instanceof BackgroundIntentError)) {
    printError(err instanceof Error ? err.message : String(err));
    return;
  }
  printError(err.message);
  switch (err.kind) {
    case 'no_auth':
      printInfo('Fix: run `eve install` (sets synap.apiUrl) or `eve auth provision --agent eve`.');
      break;
    case 'invalid_action': {
      printInfo('Use one of:');
      const valid = err.validActions ?? listEveBackgroundActions();
      for (const a of valid) {
        console.log(`  ${colors.primary(a.id.padEnd(22))} ${colors.muted(a.description)}`);
      }
      break;
    }
    case 'unauthorized':
      printInfo('Fix: `eve auth status --agent eve` then `eve auth renew --agent eve`.');
      break;
    case 'transport':
      printInfo('Fix: pod unreachable — `eve doctor` to diagnose, or check network.');
      break;
    case 'not_found':
      printInfo('Fix: confirm the id with `eve intent list`. The row may have been deleted.');
      break;
    case 'proposed':
      printInfo(
        `A proposal was created (id=${err.proposalId ?? 'unknown'}); approve it on the pod first.`,
      );
      break;
    case 'validation':
      printInfo(`Fix: re-check the inputs. ${contextHint ?? ''}`.trim());
      break;
    default:
      printInfo('Run `eve doctor` if this keeps happening.');
  }
}

// ---------------------------------------------------------------------------
// `eve intent add`
// ---------------------------------------------------------------------------

interface AddOptions extends CommonOptions {
  action: string;
  schedule?: string;
  type?: BackgroundTaskType;
  workspace?: string;
  name?: string;
}

async function runAdd(prompt: string, opts: AddOptions): Promise<void> {
  const trimmedPrompt = (prompt ?? '').trim();
  if (!trimmedPrompt) {
    printError('Prompt is required: `eve intent add "<prompt>" --action <id>`');
    process.exitCode = 1;
    return;
  }
  if (!opts.action) {
    printError('--action is required.');
    printInfo('Use one of:');
    for (const a of listEveBackgroundActions()) {
      console.log(`  ${colors.primary(a.id.padEnd(22))} ${colors.muted(a.description)}`);
    }
    process.exitCode = 1;
    return;
  }
  if (!isValidEveBackgroundAction(opts.action)) {
    printError(`Unknown action "${opts.action}".`);
    printInfo('Use one of:');
    for (const a of listEveBackgroundActions()) {
      console.log(`  ${colors.primary(a.id.padEnd(22))} ${colors.muted(a.description)}`);
    }
    process.exitCode = 1;
    return;
  }

  // Schedule resolution rules:
  //   --type interval --schedule 1h  → interval, run every 1h, next=now+1h
  //   --type cron --schedule "0 9 * * *" → cron, next computed by daemon
  //   no --schedule                  → one-shot interval, next=now+1m
  let type: BackgroundTaskType;
  let schedule: string | undefined;
  let nextRunHint: string | undefined;
  if (opts.schedule) {
    type = opts.type ?? guessTypeFromSchedule(opts.schedule);
    schedule = opts.schedule;
  } else {
    type = opts.type ?? 'interval';
    schedule = '1m';
    // Add a soft hint surfaced to the user but the daemon will compute
    // its own nextRunAt after the first run. We don't try to set
    // nextRunAt at create time — the backend service is responsible
    // for setting it on insert.
    nextRunHint = '~1m (one-shot)';
  }

  const definition = EVE_BACKGROUND_ACTIONS[opts.action];
  if (definition?.requiresWorkspace && !opts.workspace) {
    printError(`Action "${opts.action}" requires --workspace <id>.`);
    process.exitCode = 1;
    return;
  }

  const name = opts.name?.trim() || deriveName(trimmedPrompt);

  printHeader(`${emojis.sparkles} Recording intent`);
  console.log();
  printInfo(`Action:    ${colors.primary(opts.action)}`);
  printInfo(`Name:      ${name}`);
  printInfo(`Type:      ${type}`);
  if (schedule) printInfo(`Schedule:  ${schedule}`);
  if (nextRunHint) printInfo(`Next run:  ${nextRunHint}`);
  if (opts.workspace) printInfo(`Workspace: ${opts.workspace}`);
  console.log();

  try {
    const created = await recordIntent({
      name,
      description: trimmedPrompt,
      type,
      schedule,
      action: opts.action,
      workspaceId: opts.workspace,
      context: {
        userPrompt: trimmedPrompt,
      },
      auth: opts.podUrl
        ? { podUrl: opts.podUrl, apiKey: '' }
        : undefined,
    });
    printSuccess(`Intent recorded — id ${shortId(created.id)} (${created.id})`);
    if (!opts.schedule) {
      // For one-shot intents, immediately bump nextRunAt to now so the
      // daemon picks it up on the next cycle without waiting for the
      // backend to compute it.
      try {
        await updateIntent({
          id: created.id,
          patch: { nextRunAt: new Date().toISOString() },
        });
      } catch (err) {
        printWarning(
          `Intent created but force-run scheduling failed (${err instanceof Error ? err.message : String(err)}); ` +
            `it will run on its normal cadence.`,
        );
      }
    }
  } catch (err) {
    renderIntentError(err);
    process.exitCode = 1;
  }
}

function guessTypeFromSchedule(schedule: string): BackgroundTaskType {
  // 5-field whitespace-separated → cron. Otherwise → interval.
  const parts = schedule.trim().split(/\s+/);
  return parts.length === 5 ? 'cron' : 'interval';
}

// ---------------------------------------------------------------------------
// `eve intent list`
// ---------------------------------------------------------------------------

interface ListOptions extends CommonOptions {
  status?: BackgroundTaskStatus | 'all';
  type?: BackgroundTaskType;
}

async function runList(opts: ListOptions): Promise<void> {
  try {
    const rows = await listIntents({
      status: opts.status,
      type: opts.type,
    });
    if (rows.length === 0) {
      printInfo('No intents recorded yet.');
      printInfo('Add one: `eve intent add "<prompt>" --action <id>`');
      return;
    }
    const table = new Table({
      head: ['ID', 'Name', 'Action', 'Type', 'Sched.', 'Next', 'Status', 'Runs'].map((h) =>
        colors.primary(h),
      ),
      style: { head: [], border: [] },
      wordWrap: true,
    });
    for (const r of rows) {
      table.push([
        colors.muted(shortId(r.id)),
        truncate(r.name, 30),
        r.action,
        r.type,
        truncate(formatNullable(r.schedule), 12),
        formatNextRun(r),
        formatStatus(r.status),
        `${r.executionCount}`,
      ]);
    }
    console.log(table.toString());
  } catch (err) {
    renderIntentError(err);
    process.exitCode = 1;
  }
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}

// ---------------------------------------------------------------------------
// `eve intent show <id>`
// ---------------------------------------------------------------------------

async function runShow(id: string, _opts: CommonOptions): Promise<void> {
  if (!id) {
    printError('id is required: `eve intent show <id>`');
    process.exitCode = 1;
    return;
  }
  try {
    const row = await getIntent({ id });
    printHeader(`${emojis.info} ${row.name}`);
    console.log();
    printKv('ID', row.id);
    printKv('Action', row.action);
    printKv('Type', row.type);
    if (row.schedule) printKv('Schedule', row.schedule);
    printKv('Status', row.status);
    if (row.workspaceId) printKv('Workspace', row.workspaceId);
    printKv('Created', row.createdAt);
    printKv('Updated', row.updatedAt);
    printKv('Last run', formatNullable(row.lastRunAt));
    printKv('Next run', formatNullable(row.nextRunAt));
    printKv('Runs', `${row.executionCount} (✓ ${row.successCount}, ✗ ${row.failureCount})`);
    if (row.errorMessage) {
      console.log();
      printError(`Last error: ${row.errorMessage}`);
    }
    if (row.description) {
      console.log();
      printInfo('Description:');
      console.log(`  ${colors.muted(row.description)}`);
    }
    if (row.context && Object.keys(row.context).length > 0) {
      console.log();
      printInfo('Context:');
      console.log(colors.muted(JSON.stringify(row.context, null, 2)));
    }
    if (row.metadata && Object.keys(row.metadata).length > 0) {
      console.log();
      printInfo('Metadata:');
      console.log(colors.muted(JSON.stringify(row.metadata, null, 2)));
    }
  } catch (err) {
    renderIntentError(err);
    process.exitCode = 1;
  }
}

function printKv(key: string, value: string): void {
  console.log(`  ${colors.muted(key.padEnd(11))} ${value}`);
}

// ---------------------------------------------------------------------------
// `eve intent pause | resume | remove | run`
// ---------------------------------------------------------------------------

async function runPause(id: string): Promise<void> {
  if (!id) {
    printError('id required.');
    process.exitCode = 1;
    return;
  }
  try {
    const row = await pauseIntent({ id });
    printSuccess(`Paused ${shortId(row.id)} — ${row.name}`);
  } catch (err) {
    renderIntentError(err);
    process.exitCode = 1;
  }
}

async function runResume(id: string): Promise<void> {
  if (!id) {
    printError('id required.');
    process.exitCode = 1;
    return;
  }
  try {
    const row = await resumeIntent({ id });
    printSuccess(`Resumed ${shortId(row.id)} — ${row.name}`);
  } catch (err) {
    renderIntentError(err);
    process.exitCode = 1;
  }
}

async function runRemove(id: string): Promise<void> {
  if (!id) {
    printError('id required.');
    process.exitCode = 1;
    return;
  }
  try {
    await removeIntent({ id });
    printSuccess(`Removed ${shortId(id)}.`);
  } catch (err) {
    renderIntentError(err);
    process.exitCode = 1;
  }
}

async function runRun(id: string): Promise<void> {
  if (!id) {
    printError('id required.');
    process.exitCode = 1;
    return;
  }
  try {
    const row = await updateIntent({
      id,
      patch: { nextRunAt: new Date().toISOString() },
    });
    printSuccess(`Scheduled ${shortId(row.id)} for next poll cycle.`);
  } catch (err) {
    renderIntentError(err);
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function intentCommand(program: Command): void {
  const intent = program
    .command('intent')
    .description(`${emojis.sparkles} Record and manage overnight intents (background_tasks)`);

  intent
    .command('add <prompt>')
    .description('Record a new background intent.')
    .option('--action <id>', 'Action id from the registry (required).')
    .option('--schedule <schedule>', 'Cron expression (5 fields) or interval (e.g. 1h, 30m).')
    .option('--type <type>', 'cron | event | interval (auto-detected when omitted).')
    .option('--workspace <id>', 'Workspace id — required for action ids that need a workspace.')
    .option('--name <name>', 'Display name (auto-derived from the prompt when omitted).')
    .action(async (prompt: string, opts: AddOptions) => {
      try {
        await runAdd(prompt, opts);
      } catch (err) {
        printError(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      }
    })
    .addHelpText(
      'after',
      '\nAvailable actions:\n' +
        listEveBackgroundActions()
          .map((a) => `  ${a.id.padEnd(22)} ${a.description}`)
          .join('\n'),
    );

  intent
    .command('list')
    .description('List recorded intents (one row per intent).')
    .option('--status <s>', 'active | paused | error | all (default: all)')
    .option('--type <t>', 'cron | event | interval')
    .action(async (opts: ListOptions) => {
      try {
        await runList(opts);
      } catch (err) {
        printError(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      }
    });

  intent
    .command('show <id>')
    .description('Show full details for one intent.')
    .action(async (id: string, opts: CommonOptions) => {
      try {
        await runShow(id, opts);
      } catch (err) {
        printError(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      }
    });

  intent
    .command('pause <id>')
    .description('Pause an intent — the daemon will skip it until resumed.')
    .action(async (id: string) => {
      try {
        await runPause(id);
      } catch (err) {
        printError(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      }
    });

  intent
    .command('resume <id>')
    .description('Resume a paused (or errored) intent.')
    .action(async (id: string) => {
      try {
        await runResume(id);
      } catch (err) {
        printError(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      }
    });

  intent
    .command('remove <id>')
    .alias('rm')
    .description('Delete an intent permanently.')
    .action(async (id: string) => {
      try {
        await runRemove(id);
      } catch (err) {
        printError(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      }
    });

  intent
    .command('run <id>')
    .description('Force-run an intent on the next poll cycle (PATCHes nextRunAt = now).')
    .action(async (id: string) => {
      try {
        await runRun(id);
      } catch (err) {
        printError(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      }
    });
}
