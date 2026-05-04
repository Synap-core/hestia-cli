/**
 * Background Task wire types — Eve-side mirror.
 *
 * Mirror of the row shape exposed by Hub Protocol REST under
 * `/api/hub/background-tasks/*`. Canonical schema lives at:
 *   synap-backend/packages/database/src/schema/background-tasks.ts
 *
 * Why this is a hand-written interface and not a re-export: Eve does
 * NOT depend on the synap-backend package at runtime — Hub Protocol
 * is the contract. Field-for-field copy keeps the two pinned without
 * pulling in Drizzle / Postgres / Zod just to spell out the shape.
 *
 * Date fields arrive as ISO-8601 strings on the wire. The backend's
 * select shape uses `Date` objects in-process, but Hono serialises
 * them to strings and the Hub REST OpenAPI declaration uses
 * `string().nullable()` for every timestamp.
 */

/** Schedule kind. Matches the DB enum. */
export type BackgroundTaskType = 'cron' | 'event' | 'interval';

/** Lifecycle state. Matches the DB enum. */
export type BackgroundTaskStatus = 'active' | 'paused' | 'error';

/**
 * Wire shape for one background task. Every field that is `nullable`
 * in Postgres is `string | null` here.
 */
export interface BackgroundTask {
  id: string;
  userId: string;
  workspaceId: string | null;
  name: string;
  description: string | null;
  type: BackgroundTaskType;
  /** Cron expression / interval string ("1h", "30m") / event pattern. */
  schedule: string | null;
  /** Registered action id from the action registry. */
  action: string;
  /** Free-form runner context. Persisted as JSONB on the pod. */
  context: Record<string, unknown>;
  status: BackgroundTaskStatus;
  errorMessage: string | null;
  /** ISO-8601. Null until first execution. */
  lastRunAt: string | null;
  /** ISO-8601. Null when not scheduled (e.g. event-driven). */
  nextRunAt: string | null;
  executionCount: number;
  successCount: number;
  failureCount: number;
  metadata: Record<string, unknown>;
  /** ISO-8601. */
  createdAt: string;
  /** ISO-8601. */
  updatedAt: string;
}
