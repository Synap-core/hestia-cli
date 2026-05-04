/**
 * Background-intent SDK — thin Hub Protocol REST wrapper.
 *
 * Surface called by:
 *   - The CLI (`eve intent add | list | show | pause | resume | remove | run`)
 *   - The Hermes daemon (background-intent poll loop, see hermes-daemon.ts)
 *
 * Auth: every call uses the `eve` agent's Hub Protocol API key — pulled
 * from `secrets.agents.eve.hubApiKey` (with the legacy single-key fallback
 * baked in via `readAgentKeyOrLegacy`). The backend enforces user-scoping
 * server-side: `userId = currentUserId(c)` is set by the hub-protocol-rest
 * middleware, so every read/write is automatically pinned to the agent's
 * user record on the pod.
 *
 * Failure model: every function rejects with a typed `BackgroundIntentError`
 * whose `kind` discriminates wire-level vs. validation-level vs. proposal-
 * created cases. Callers can switch on `kind` for fix hints.
 *
 * Dependency note: this module uses the platform's native `fetch` rather
 * than the diagnostics' `IDoctorRunner` abstraction because the runner
 * doesn't expose PATCH (Round 1 / 1B never needed it for diagnostics).
 * The fetch path is fine here — operators run `eve intent` from the host
 * with normal network access; if the pod is unreachable on `127.0.0.1`
 * the existing `eve doctor` command remains the place to debug transport
 * issues.
 */

import {
  type BackgroundTask,
  type BackgroundTaskStatus,
  type BackgroundTaskType,
  isValidEveBackgroundAction,
  listEveBackgroundActions,
  readAgentKeyOrLegacy,
  readEveSecrets,
} from '@eve/dna';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Resolved auth + URL the SDK needs to call Hub REST. */
export interface BackgroundIntentAuth {
  /** Pod base URL — `${apiUrl}/api/hub` is constructed internally. */
  podUrl: string;
  /** Bearer token (eve agent key). */
  apiKey: string;
}

/**
 * Caller-provided form of `BackgroundIntentAuth`. Either pass a fully
 * resolved auth blob OR pass `secrets`-shaped opts to let the SDK
 * resolve them from the local `.eve/secrets/secrets.json`.
 */
export interface BackgroundIntentSecretOpts {
  /**
   * Optional CWD override for `readEveSecrets` — defaults to
   * `process.env.EVE_HOME ?? process.cwd()`. Tests pass a tmpdir.
   */
  cwd?: string;
  /**
   * If passed, skips the secrets read and uses these values verbatim.
   * Useful when the caller already has the eve agent key (e.g. inside
   * Hermes, which reads its OWN agent key but proxies for the user via
   * the eve key for intent management).
   */
  auth?: BackgroundIntentAuth;
}

export interface RecordIntentOptions extends BackgroundIntentSecretOpts {
  name: string;
  description?: string;
  type: BackgroundTaskType;
  schedule?: string;
  action: string;
  context?: Record<string, unknown>;
  workspaceId?: string;
}

export interface ListIntentsOptions extends BackgroundIntentSecretOpts {
  status?: BackgroundTaskStatus | 'all';
  type?: BackgroundTaskType;
  workspaceId?: string;
  limit?: number;
  offset?: number;
}

export interface SingleIntentOptions extends BackgroundIntentSecretOpts {
  id: string;
}

export interface UpdateIntentOptions extends BackgroundIntentSecretOpts {
  id: string;
  patch: BackgroundIntentPatch;
}

/** Shape accepted by `PATCH /background-tasks/:id`. */
export interface BackgroundIntentPatch {
  name?: string;
  description?: string;
  schedule?: string;
  action?: string;
  context?: Record<string, unknown>;
  status?: BackgroundTaskStatus;
  /** ISO-8601. Bump to "now" to force-run on the next poll cycle. */
  nextRunAt?: string;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type BackgroundIntentErrorKind =
  | 'no_auth'
  | 'invalid_action'
  | 'transport'
  | 'unauthorized'
  | 'not_found'
  | 'proposed'
  | 'validation'
  | 'backend';

export class BackgroundIntentError extends Error {
  readonly kind: BackgroundIntentErrorKind;
  readonly httpStatus: number;
  readonly raw?: unknown;
  /** Set when kind === "proposed" (HTTP 202). */
  readonly proposalId?: string;
  /** Set when kind === "invalid_action" — the registry as the backend sees it. */
  readonly validActions?: Array<{ id: string; description: string }>;

  constructor(opts: {
    kind: BackgroundIntentErrorKind;
    message: string;
    httpStatus: number;
    raw?: unknown;
    proposalId?: string;
    validActions?: Array<{ id: string; description: string }>;
  }) {
    super(opts.message);
    this.name = 'BackgroundIntentError';
    this.kind = opts.kind;
    this.httpStatus = opts.httpStatus;
    this.raw = opts.raw;
    this.proposalId = opts.proposalId;
    this.validActions = opts.validActions;
  }
}

// ---------------------------------------------------------------------------
// Auth resolution
// ---------------------------------------------------------------------------

async function resolveAuth(
  opts: BackgroundIntentSecretOpts,
): Promise<BackgroundIntentAuth> {
  if (opts.auth) {
    if (!opts.auth.podUrl || !opts.auth.apiKey) {
      throw new BackgroundIntentError({
        kind: 'no_auth',
        message: 'auth.podUrl and auth.apiKey are required',
        httpStatus: 0,
      });
    }
    return opts.auth;
  }
  const cwd = opts.cwd ?? process.env.EVE_HOME ?? process.cwd();
  const secrets = await readEveSecrets(cwd);
  const podUrl = secrets?.synap?.apiUrl?.trim() ?? '';
  if (!podUrl) {
    throw new BackgroundIntentError({
      kind: 'no_auth',
      message:
        'synap.apiUrl not set in secrets.json — run `eve install` first',
      httpStatus: 0,
    });
  }
  const apiKey = await readAgentKeyOrLegacy('eve', cwd);
  if (!apiKey) {
    throw new BackgroundIntentError({
      kind: 'no_auth',
      message:
        'No eve agent key on disk — run `eve auth provision --agent eve`',
      httpStatus: 0,
    });
  }
  return { podUrl, apiKey };
}

function hubUrl(podUrl: string, path: string): string {
  const base = podUrl.replace(/\/+$/, '');
  return `${base}/api/hub${path.startsWith('/') ? path : `/${path}`}`;
}

function authHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    Accept: 'application/json',
  };
}

// ---------------------------------------------------------------------------
// Wire helpers
// ---------------------------------------------------------------------------

async function parseJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function intoError(
  status: number,
  body: unknown,
  fallback: string,
): BackgroundIntentError {
  if (status === 401 || status === 403) {
    return new BackgroundIntentError({
      kind: 'unauthorized',
      message: extractMessage(body) ?? `unauthorized (${status})`,
      httpStatus: status,
      raw: body,
    });
  }
  if (status === 404) {
    return new BackgroundIntentError({
      kind: 'not_found',
      message: extractMessage(body) ?? 'not found',
      httpStatus: status,
      raw: body,
    });
  }
  if (status === 400 && isInvalidActionBody(body)) {
    const obj = body as { error?: string; validActions?: unknown };
    return new BackgroundIntentError({
      kind: 'invalid_action',
      message: typeof obj.error === 'string' ? obj.error : 'invalid action',
      httpStatus: 400,
      raw: body,
      validActions: Array.isArray(obj.validActions)
        ? (obj.validActions as Array<{ id: string; description: string }>)
        : undefined,
    });
  }
  if (status === 400) {
    return new BackgroundIntentError({
      kind: 'validation',
      message: extractMessage(body) ?? 'invalid request',
      httpStatus: 400,
      raw: body,
    });
  }
  if (status === 202 && isProposedBody(body)) {
    const obj = body as { proposalId?: string };
    return new BackgroundIntentError({
      kind: 'proposed',
      message: 'Proposal created — pending approval',
      httpStatus: 202,
      raw: body,
      proposalId: typeof obj.proposalId === 'string' ? obj.proposalId : undefined,
    });
  }
  return new BackgroundIntentError({
    kind: 'backend',
    message:
      extractMessage(body) ??
      `${fallback} (HTTP ${status})`,
    httpStatus: status,
    raw: body,
  });
}

function isInvalidActionBody(body: unknown): boolean {
  return (
    typeof body === 'object' &&
    body !== null &&
    'error' in (body as Record<string, unknown>) &&
    'validActions' in (body as Record<string, unknown>)
  );
}

function isProposedBody(body: unknown): boolean {
  return (
    typeof body === 'object' &&
    body !== null &&
    (body as Record<string, unknown>).status === 'proposed'
  );
}

function extractMessage(body: unknown): string | null {
  if (typeof body === 'string') return body;
  if (typeof body !== 'object' || body === null) return null;
  const obj = body as Record<string, unknown>;
  if (typeof obj.error === 'string') return obj.error;
  if (typeof obj.message === 'string') return obj.message;
  return null;
}

async function doFetch(
  url: string,
  init: RequestInit,
): Promise<{ status: number; body: unknown }> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    throw new BackgroundIntentError({
      kind: 'transport',
      message: `network error: ${err instanceof Error ? err.message : String(err)}`,
      httpStatus: 0,
    });
  }
  const body = await parseJson(res);
  return { status: res.status, body };
}

// ---------------------------------------------------------------------------
// recordIntent — POST /background-tasks
// ---------------------------------------------------------------------------

export async function recordIntent(
  opts: RecordIntentOptions,
): Promise<BackgroundTask> {
  if (!isValidEveBackgroundAction(opts.action)) {
    throw new BackgroundIntentError({
      kind: 'invalid_action',
      message: `Unknown action "${opts.action}"`,
      httpStatus: 0,
      validActions: listEveBackgroundActions(),
    });
  }
  const auth = await resolveAuth(opts);
  const body: Record<string, unknown> = {
    name: opts.name,
    type: opts.type,
    action: opts.action,
  };
  if (opts.description !== undefined) body.description = opts.description;
  if (opts.schedule !== undefined) body.schedule = opts.schedule;
  if (opts.workspaceId !== undefined) body.workspaceId = opts.workspaceId;
  if (opts.context !== undefined) body.context = opts.context;

  const { status, body: payload } = await doFetch(
    hubUrl(auth.podUrl, '/background-tasks'),
    {
      method: 'POST',
      headers: {
        ...authHeaders(auth.apiKey),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
  );

  if (status === 200) {
    const obj = payload as { id?: string };
    if (typeof obj?.id !== 'string') {
      throw new BackgroundIntentError({
        kind: 'backend',
        message: 'POST /background-tasks did not return an id',
        httpStatus: status,
        raw: payload,
      });
    }
    return getIntent({ id: obj.id, auth });
  }
  throw intoError(status, payload, 'failed to create background task');
}

// ---------------------------------------------------------------------------
// listIntents — GET /background-tasks
// ---------------------------------------------------------------------------

export async function listIntents(
  opts: ListIntentsOptions,
): Promise<BackgroundTask[]> {
  const auth = await resolveAuth(opts);
  const url = new URL(hubUrl(auth.podUrl, '/background-tasks'));
  if (opts.status) url.searchParams.set('status', opts.status);
  if (opts.type) url.searchParams.set('type', opts.type);
  if (opts.workspaceId) url.searchParams.set('workspaceId', opts.workspaceId);
  if (opts.limit !== undefined) url.searchParams.set('limit', String(opts.limit));
  if (opts.offset !== undefined) url.searchParams.set('offset', String(opts.offset));

  const { status, body } = await doFetch(url.toString(), {
    method: 'GET',
    headers: authHeaders(auth.apiKey),
  });
  if (status !== 200) {
    throw intoError(status, body, 'failed to list background tasks');
  }
  const obj = body as { tasks?: BackgroundTask[] };
  return Array.isArray(obj?.tasks) ? obj.tasks : [];
}

// ---------------------------------------------------------------------------
// getIntent — GET /background-tasks/:id
// ---------------------------------------------------------------------------

export async function getIntent(
  opts: SingleIntentOptions,
): Promise<BackgroundTask> {
  const auth = await resolveAuth(opts);
  const { status, body } = await doFetch(
    hubUrl(auth.podUrl, `/background-tasks/${encodeURIComponent(opts.id)}`),
    { method: 'GET', headers: authHeaders(auth.apiKey) },
  );
  if (status === 200) {
    const obj = body as { task?: BackgroundTask };
    if (!obj?.task) {
      throw new BackgroundIntentError({
        kind: 'backend',
        message: 'GET /background-tasks/:id returned no `task` field',
        httpStatus: status,
        raw: body,
      });
    }
    return obj.task;
  }
  throw intoError(status, body, 'failed to fetch background task');
}

// ---------------------------------------------------------------------------
// updateIntent — PATCH /background-tasks/:id
// ---------------------------------------------------------------------------

export async function updateIntent(
  opts: UpdateIntentOptions,
): Promise<BackgroundTask> {
  if (opts.patch.action !== undefined && !isValidEveBackgroundAction(opts.patch.action)) {
    throw new BackgroundIntentError({
      kind: 'invalid_action',
      message: `Unknown action "${opts.patch.action}"`,
      httpStatus: 0,
      validActions: listEveBackgroundActions(),
    });
  }
  const auth = await resolveAuth(opts);
  const { status, body } = await doFetch(
    hubUrl(auth.podUrl, `/background-tasks/${encodeURIComponent(opts.id)}`),
    {
      method: 'PATCH',
      headers: {
        ...authHeaders(auth.apiKey),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(opts.patch),
    },
  );
  if (status === 200) {
    return getIntent({ id: opts.id, auth });
  }
  throw intoError(status, body, 'failed to update background task');
}

// ---------------------------------------------------------------------------
// pauseIntent / resumeIntent — convenience wrappers
// ---------------------------------------------------------------------------

export async function pauseIntent(
  opts: SingleIntentOptions,
): Promise<BackgroundTask> {
  return updateIntent({ ...opts, patch: { status: 'paused' } });
}

export async function resumeIntent(
  opts: SingleIntentOptions,
): Promise<BackgroundTask> {
  return updateIntent({ ...opts, patch: { status: 'active' } });
}

// ---------------------------------------------------------------------------
// removeIntent — DELETE /background-tasks/:id
// ---------------------------------------------------------------------------

export async function removeIntent(
  opts: SingleIntentOptions,
): Promise<void> {
  const auth = await resolveAuth(opts);
  const { status, body } = await doFetch(
    hubUrl(auth.podUrl, `/background-tasks/${encodeURIComponent(opts.id)}`),
    { method: 'DELETE', headers: authHeaders(auth.apiKey) },
  );
  if (status === 200) return;
  throw intoError(status, body, 'failed to delete background task');
}
