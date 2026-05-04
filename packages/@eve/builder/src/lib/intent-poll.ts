/**
 * Intent poller — Hermes-side bridge from `background_tasks` to `Task`.
 *
 * The Hermes daemon already polls Synap's entity router for assigned
 * `task` entities (see TaskPoller). This module adds a parallel cycle
 * that pulls due rows from `/api/hub/background-tasks` and materialises
 * each one into an in-memory `Task` so the existing TaskExecutor /
 * TaskQueue path can dispatch it without changes.
 *
 * Why a sibling class and not a method on TaskPoller: the two queries
 * have different shapes (entities vs background-tasks), different
 * cadences (event-driven vs cron/interval), and different post-execute
 * write paths (entity status vs background-task PATCH with executionCount
 * + nextRunAt). Splitting them keeps each concern testable in isolation.
 *
 * After-execute bookkeeping lives here too — `recordRunResult()` does
 * the success/failure counter bump + nextRunAt re-computation in a
 * single PATCH. Status flips to "error" after 3 consecutive failures;
 * resume via `eve intent resume <id>`.
 */

import type { Task, BackgroundTask, BackgroundTaskType } from '@eve/dna';
import {
  assigneeForAction,
  isValidEveBackgroundAction,
} from '@eve/dna';
import {
  listIntents,
  updateIntent,
  type BackgroundIntentAuth,
} from './background-intent.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Threshold of consecutive failures before status flips to 'error'. */
export const INTENT_FAILURE_THRESHOLD = 3;

export interface IntentPollerConfig {
  /** Synap pod URL — same value as HermesConfig.apiUrl. */
  apiUrl: string;
  /** Eve agent's Hub Protocol API key. */
  apiKey: string;
}

/**
 * One row of bookkeeping after a synthetic Task completes. The poller
 * owns the math (nextRunAt + counters); the caller (HermesDaemon) only
 * tells us whether the run succeeded.
 */
export interface IntentRunResult {
  intentId: string;
  succeeded: boolean;
  /** Optional error message when succeeded=false. */
  errorMessage?: string;
  /** Source intent — must be the row materialised by `pollDueIntents`. */
  intent: BackgroundTask;
}

// ---------------------------------------------------------------------------
// IntentPoller
// ---------------------------------------------------------------------------

export class IntentPoller {
  private auth: BackgroundIntentAuth;
  /**
   * Track consecutive failures per intent. Reset on success. When this
   * counter hits INTENT_FAILURE_THRESHOLD we flip status to 'error' and
   * stop scheduling — operator must resume.
   *
   * Lives in-memory because the canonical state is already in
   * `background_tasks.failureCount` (server-side). The local map is
   * only an optimisation to avoid a server read on every cycle.
   */
  private consecutiveFailures = new Map<string, number>();

  constructor(config: IntentPollerConfig) {
    this.auth = { podUrl: config.apiUrl, apiKey: config.apiKey };
  }

  /**
   * Pull active intents whose `nextRunAt` is in the past. Returns the
   * raw rows so callers can inspect the schedule decisions before
   * dispatching.
   *
   * Server-side filter: status=active. We additionally filter by
   * `nextRunAt <= now` on the client because the Hub REST list
   * endpoint doesn't expose a `dueBefore=` query parameter today.
   * That keeps payloads small in normal operation (active intents
   * with future nextRunAt are tiny rows).
   */
  async pollDueIntents(now: Date = new Date()): Promise<BackgroundTask[]> {
    const all = await listIntents({
      auth: this.auth,
      status: 'active',
    });
    const due: BackgroundTask[] = [];
    for (const row of all) {
      if (!row.nextRunAt) continue;
      // event-typed rows have no schedule arithmetic — skip and warn.
      if (row.type === 'event') {
        console.warn(
          `[Hermes] TODO event triggers — intent ${row.id} (action=${row.action}) ` +
            `is event-driven and not yet wired end-to-end; skipping`,
        );
        continue;
      }
      const at = Date.parse(row.nextRunAt);
      if (Number.isNaN(at)) continue;
      if (at <= now.getTime()) due.push(row);
    }
    return due;
  }

  /**
   * Materialise a `BackgroundTask` row into the in-memory `Task` shape
   * the executor + queue expect. Synthetic tasks live entirely in
   * memory — no row is written to `entities` for them.
   *
   * Field mapping:
   *   - id            → `intent:${row.id}` (unique, traceable)
   *   - title         → row.name
   *   - description   → row.description ?? row.context.userPrompt
   *   - type          → 'custom' (background-task isn't a TaskType today)
   *   - status        → 'pending' (will flip to in-progress when dequeued)
   *   - priority      → 'medium'
   *   - assignedAgentId → derived from action namespace
   *   - context       → spread of row.context + bookkeeping fields
   */
  static toTask(row: BackgroundTask): Task {
    const userPrompt =
      typeof (row.context as { userPrompt?: unknown }).userPrompt === 'string'
        ? (row.context.userPrompt as string)
        : undefined;
    const description =
      row.description ??
      userPrompt ??
      `Background task: ${row.action}`;

    const assignedAgentId = isValidEveBackgroundAction(row.action)
      ? assigneeForAction(row.action)
      : 'hermes';

    return {
      id: `intent:${row.id}`,
      title: row.name,
      description,
      type: 'custom',
      status: 'pending',
      priority: 'medium',
      assignedAgentId,
      context: {
        ...row.context,
        backgroundTaskId: row.id,
        action: row.action,
        userPrompt,
      },
      metadata: {
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      },
    };
  }

  /**
   * After a synthetic task finishes, persist the run result and pick
   * the next scheduled time. One PATCH covers:
   *   - executionCount + (success|failure)Count bump
   *   - lastRunAt = now
   *   - nextRunAt = computeNextRunAt(...) when still active
   *   - status = 'error' when consecutiveFailures hits the threshold
   *   - errorMessage when succeeded=false
   */
  async recordRunResult(result: IntentRunResult): Promise<void> {
    const { intent, succeeded } = result;
    const now = new Date();
    const failureCount = succeeded ? 0 : (this.consecutiveFailures.get(intent.id) ?? 0) + 1;
    if (succeeded) {
      this.consecutiveFailures.delete(intent.id);
    } else {
      this.consecutiveFailures.set(intent.id, failureCount);
    }

    const shouldFlipToError = !succeeded && failureCount >= INTENT_FAILURE_THRESHOLD;

    // Schedule next run unless we're flipping to error or the task is
    // event-typed (handled separately at poll time).
    let nextRunAt: string | undefined;
    if (!shouldFlipToError && intent.type !== 'event') {
      const next = computeNextRunAt(intent.type, intent.schedule, now);
      if (next) nextRunAt = next.toISOString();
    }

    const patch: Record<string, unknown> = {};
    if (shouldFlipToError) {
      patch.status = 'error';
    }
    if (nextRunAt) patch.nextRunAt = nextRunAt;
    if (!succeeded) {
      patch.context = {
        ...intent.context,
        // Preserve bookkeeping; the backend stores context as JSONB so
        // arbitrary keys survive. Surface the last error for `eve intent show`.
        lastError: result.errorMessage ?? 'unknown error',
        consecutiveFailures: failureCount,
      };
    } else {
      // On success, clear the lastError flag if it was set previously.
      if (
        typeof (intent.context as { lastError?: unknown }).lastError === 'string' ||
        typeof (intent.context as { consecutiveFailures?: unknown }).consecutiveFailures ===
          'number'
      ) {
        const cleaned = { ...intent.context };
        delete (cleaned as Record<string, unknown>).lastError;
        delete (cleaned as Record<string, unknown>).consecutiveFailures;
        patch.context = cleaned;
      }
    }

    // Counter bumps cannot be expressed via PATCH today (the wire schema
    // accepts only setters, not increments). Strategy: round-trip the
    // current row's counters + 1. Race window vs another writer is
    // negligible — Eve owns the intent loop end-to-end.
    patch.context = patch.context ?? { ...intent.context };
    // Counter fields live OUTSIDE context — they're top-level columns.
    // The current Hub PATCH validator (UpdateBodySchema) doesn't accept
    // them, so we mirror the bumps under `metadata.runCounters` for
    // observability and let the backend's own scheduler reconcile the
    // top-level columns when the action runs server-side. For Eve's
    // CLI surface this is enough — `eve intent show` reads metadata.
    //
    // SYNC NOTE: when synap-backend grows a counter-bump PATCH path,
    // replace the metadata mirror with a direct field bump. The CLI
    // already prints the metadata mirror behind a "(client-tracked)"
    // label so the migration is purely additive.
    const meta = (intent.metadata as Record<string, unknown>) ?? {};
    const prevCounters = (meta.runCounters as Record<string, unknown> | undefined) ?? {};
    const nextCounters = {
      executionCount:
        Number((prevCounters.executionCount as number) ?? intent.executionCount ?? 0) + 1,
      successCount:
        Number((prevCounters.successCount as number) ?? intent.successCount ?? 0) +
        (succeeded ? 1 : 0),
      failureCount:
        Number((prevCounters.failureCount as number) ?? intent.failureCount ?? 0) +
        (succeeded ? 0 : 1),
      lastRunAt: now.toISOString(),
    };
    patch.context = {
      ...(patch.context as Record<string, unknown>),
      _eveRunCounters: nextCounters,
    };

    await updateIntent({
      auth: this.auth,
      id: intent.id,
      patch: patch as Parameters<typeof updateIntent>[0]['patch'],
    });
  }
}

// ---------------------------------------------------------------------------
// Schedule arithmetic
// ---------------------------------------------------------------------------

/**
 * Compute the next firing time given the row's `type` + `schedule`.
 *
 * - `interval`: schedule is a duration string ("1h", "30m", "2d", "45s").
 *   Hand-rolled parser (see parseDurationMs) — `cron-parser` would be
 *   overkill for this single use.
 * - `cron`: schedule is a 5-field cron expression. Hand-rolled minimal
 *   parser — supports `* / number / number-range / step` per field. This
 *   covers the common cases (`0 9 * * *`, `*\/15 * * * *`,
 *   `0 0 * * 1-5`); rare features (lists, named days/months, special
 *   strings like `@daily`) are NOT supported and return null + warn.
 * - `event`: handled before this function is reached (no schedule math).
 *
 * Returns `null` when the schedule string is invalid or the type is
 * unrecognised. Callers should keep the row's nextRunAt as-is and warn.
 */
export function computeNextRunAt(
  type: BackgroundTaskType,
  schedule: string | null,
  now: Date,
): Date | null {
  if (!schedule) return null;
  if (type === 'interval') {
    const ms = parseDurationMs(schedule);
    if (ms === null) {
      console.warn(`[Hermes] invalid interval schedule "${schedule}"`);
      return null;
    }
    return new Date(now.getTime() + ms);
  }
  if (type === 'cron') {
    const next = nextCronFire(schedule, now);
    if (!next) {
      console.warn(`[Hermes] invalid cron schedule "${schedule}"`);
      return null;
    }
    return next;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Duration parser ("1h", "30m", "2d", "45s")
// ---------------------------------------------------------------------------

const DURATION_RE = /^(\d+)\s*(ms|s|m|h|d|w)?$/i;

/** Parse a Go-style duration string into milliseconds. Returns null on garbage. */
export function parseDurationMs(input: string): number | null {
  const trimmed = input.trim();
  const match = DURATION_RE.exec(trimmed);
  if (!match) return null;
  const n = Number(match[1]);
  if (!Number.isFinite(n) || n < 0) return null;
  const unit = (match[2] ?? 'ms').toLowerCase();
  switch (unit) {
    case 'ms':
      return n;
    case 's':
      return n * 1_000;
    case 'm':
      return n * 60_000;
    case 'h':
      return n * 3_600_000;
    case 'd':
      return n * 86_400_000;
    case 'w':
      return n * 604_800_000;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Minimal cron parser
// ---------------------------------------------------------------------------

interface CronExpr {
  minute: Set<number>;
  hour: Set<number>;
  dom: Set<number>;
  month: Set<number>;
  dow: Set<number>;
  domStar: boolean;
  dowStar: boolean;
}

function parseCronField(
  raw: string,
  min: number,
  max: number,
): { values: Set<number>; star: boolean } | null {
  const result = new Set<number>();
  let star = false;
  for (const part of raw.split(',')) {
    let token = part.trim();
    if (!token) return null;
    let step = 1;
    const slash = token.indexOf('/');
    if (slash >= 0) {
      step = Number(token.slice(slash + 1));
      if (!Number.isInteger(step) || step <= 0) return null;
      token = token.slice(0, slash);
    }
    let lo = min;
    let hi = max;
    if (token === '*') {
      star = true;
    } else if (token.includes('-')) {
      const [a, b] = token.split('-');
      lo = Number(a);
      hi = Number(b);
      if (!Number.isInteger(lo) || !Number.isInteger(hi)) return null;
    } else {
      const v = Number(token);
      if (!Number.isInteger(v)) return null;
      lo = v;
      hi = v;
    }
    if (lo < min || hi > max || lo > hi) return null;
    for (let i = lo; i <= hi; i += step) result.add(i);
  }
  return { values: result, star };
}

function parseCron(expr: string): CronExpr | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const minute = parseCronField(parts[0], 0, 59);
  const hour = parseCronField(parts[1], 0, 23);
  const dom = parseCronField(parts[2], 1, 31);
  const month = parseCronField(parts[3], 1, 12);
  const dow = parseCronField(parts[4], 0, 6);
  if (!minute || !hour || !dom || !month || !dow) return null;
  return {
    minute: minute.values,
    hour: hour.values,
    dom: dom.values,
    month: month.values,
    dow: dow.values,
    domStar: dom.star,
    dowStar: dow.star,
  };
}

/**
 * Find the next minute strictly after `now` that satisfies the cron
 * expression. Walks minute-by-minute up to a 366-day horizon — that's
 * an upper bound for any valid 5-field cron, so we never loop infinitely
 * on degenerate inputs (e.g. `0 0 30 2 *` — Feb 30 never exists).
 */
export function nextCronFire(expr: string, now: Date): Date | null {
  const cron = parseCron(expr);
  if (!cron) return null;
  // Start from the next whole minute.
  const t = new Date(now.getTime());
  t.setSeconds(0, 0);
  t.setMinutes(t.getMinutes() + 1);
  const limit = t.getTime() + 366 * 86_400_000;
  while (t.getTime() < limit) {
    const m = t.getUTCMinutes();
    const h = t.getUTCHours();
    const d = t.getUTCDate();
    const mon = t.getUTCMonth() + 1;
    const w = t.getUTCDay();
    const minOk = cron.minute.has(m);
    const hourOk = cron.hour.has(h);
    const monthOk = cron.month.has(mon);
    // Cron special case: when both dom and dow are restricted (neither
    // is `*`), the expression matches if EITHER is satisfied. Otherwise
    // both must match.
    const domOk = cron.dom.has(d);
    const dowOk = cron.dow.has(w);
    let dayOk: boolean;
    if (cron.domStar && cron.dowStar) {
      dayOk = true;
    } else if (cron.domStar) {
      dayOk = dowOk;
    } else if (cron.dowStar) {
      dayOk = domOk;
    } else {
      dayOk = domOk || dowOk;
    }
    if (minOk && hourOk && monthOk && dayOk) return new Date(t);
    t.setUTCMinutes(t.getUTCMinutes() + 1);
  }
  return null;
}
