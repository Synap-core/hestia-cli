/**
 * @eve/dna — OpenWebUI admin API client.
 *
 * Single source of truth for JWT forging, admin API calls, and service
 * discovery. All other code (lifecycle, wire-ai) delegates to this module
 * for OpenWebUI interactions.
 *
 * Key constraint: OpenWebUI's admin APIs require admin-level JWT auth.
 * The JWT is forged using WEBUI_SECRET_KEY + admin user info from the
 * SQLite DB. If any step fails (no admin user, no secret key, container
 * not up), the function returns null/undefined instead of throwing.
 */
import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { COMPONENTS } from './components.js';

const require = createRequire(import.meta.url);
const { createHmac, randomUUID } = require('node:crypto');

// ── Types ──

export interface AdminUser {
  id: string;
  email: string;
}

export interface PipelineRegistration {
  url: string;
  name: string;
  /** The pipeline definitions known to OpenWebUI */
  pipelines?: {
    uid: string;
    name: string;
    description?: string;
    /** e.g. "filter", "manifold" */
    type: string;
    /** e.g. "inlet", "outlet", "filter" */
    hook?: string;
  }[];
}

export interface OpenWebuiConfig {
  openai?: {
    api_base_urls?: string[];
    api_keys?: string[];
    metadata?: Record<string, ModelSourceMetadata>;
  };
  // Other config keys may exist
  [key: string]: unknown;
}

export type OpenWebuiDefaultModels = string | string[];

export interface OpenWebuiManagedConfig {
  /** Eve-managed OpenAI-compatible model sources. Other sources are preserved. */
  modelSources?: ModelSource[];
  /** OpenWebUI default model selection. Preserves existing config key casing/shape where possible. */
  defaultModels?: OpenWebuiDefaultModels;
  webuiUrl?: string;
  webuiName?: string;
  enableSignup?: boolean;
  defaultUserRole?: string;
}

export interface OpenWebuiConfigReconcileResult {
  config: OpenWebuiConfig;
  changed: boolean;
  changedKeys: string[];
}

export type OpenwebuiStatus =
  | { status: 'healthy'; adminUser: AdminUser | null }
  | { status: 'no-admin-user'; adminUser: null; error?: string }
  | { status: 'not-reachable' }
  | { status: 'no-secret-key' }
  | { status: 'html-response' }; // Got HTTP 200 but HTML, not JSON

/**
 * Distinct failure stages for `registerOpenwebuiAdminApi`. Each maps to one
 * actionable operator fix; the `reason` carries the underlying detail so the
 * "after retries" black-box message is gone.
 */
export type RegisterStage =
  | 'health'         // OWUI /health did not become non-HTML JSON within budget
  | 'secret-key'     // WEBUI_SECRET_KEY missing in /opt/openwebui/.env
  | 'admin-row'      // docker exec admin-user query failed or returned nothing
  | 'jwt-rejected'   // admin API returned 401/403 to a forged JWT
  | 'reconcile';     // managed-config read/save failed for any other reason

/**
 * Result of `registerOpenwebuiAdminApi`. Replaces the old `Promise<boolean>`
 * — `ok=false` carries a stage so operators get an actionable diagnosis.
 */
export type RegisterOutcome =
  | { ok: true }
  | { ok: false; stage: RegisterStage; reason: string };

// ── Constants ──

// ── Helpers ──

/**
 * Read the live host port that Docker actually published for OpenWebUI's
 * 8080 container port. Returns null when docker isn't reachable or the
 * container isn't running. Lets us recover when the operator overrides
 * `OPEN_WEBUI_PORT` in `/opt/openwebui/.env` away from the registry default.
 */
function resolveLiveAdminPort(): number | null {
  try {
    const out = execSync(
      'docker port hestia-openwebui 8080',
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] },
    ).trim();
    // `docker port` lines look like "0.0.0.0:3011" or "[::]:3011" — possibly multiple.
    const match = out.match(/:(\d+)\s*$/m);
    if (match) {
      const port = parseInt(match[1], 10);
      if (port > 0) return port;
    }
  } catch { /* fall through to registry default */ }
  return null;
}

/**
 * Resolve the base URL for OpenWebUI's admin API on the host. Prefers the
 * live-published port from `docker port` so an operator-overridden
 * `OPEN_WEBUI_PORT` is honored automatically.
 *
 * Exported so siblings (`openwebui-skills-sync`, `openwebui-tools-sync`,
 * `openwebui-knowledge-sync`) can share the same resolution path instead
 * of duplicating a strictly-registry-default version that misses the live
 * port override.
 */
export function resolveOpenwebuiAdminUrl(hostPort?: number): string {
  if (hostPort) return `http://127.0.0.1:${hostPort}`;
  const live = resolveLiveAdminPort();
  if (live) return `http://127.0.0.1:${live}`;
  const comp = COMPONENTS.find(c => c.id === 'openwebui');
  return `http://127.0.0.1:${comp?.service?.hostPort ?? 3011}`;
}

/** @deprecated — kept as the file-local alias used throughout this module. */
const resolveAdminUrl = resolveOpenwebuiAdminUrl;

/**
 * Last-resort probe that bypasses the host port mapping by hitting OWUI's
 * own loopback inside the container. Diagnostic only — when this succeeds
 * but the host loopback fails, the host port mapping is broken (most
 * common cause: `OPEN_WEBUI_PORT` overridden, port collision on bind).
 */
function probeHealthInternal(): { ok: boolean; reason?: string } {
  try {
    const out = execSync(
      `docker exec hestia-openwebui python3 -c "import urllib.request,sys
try:
    r=urllib.request.urlopen('http://localhost:8080/api/version',timeout=5)
    sys.stdout.write(f'{r.status}\\n')
    sys.stdout.write(r.read(200).decode('utf-8','ignore'))
except Exception as e:
    sys.stderr.write(str(e))
    sys.exit(2)"`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
    const text = out.toString();
    const lines = text.split('\n');
    const status = parseInt(lines[0] ?? '', 10);
    const body = lines.slice(1).join('\n').trim();
    if (status >= 200 && status < 300 && !body.startsWith('<')) {
      return { ok: true };
    }
    return { ok: false, reason: `HTTP ${status || '?'}, body=${body.slice(0, 100)}` };
  } catch (err: unknown) {
    const stderrBuf = (err as { stderr?: Buffer })?.stderr;
    const stderrStr = stderrBuf?.toString().trim();
    const fallback = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: stderrStr || fallback };
  }
}

/**
 * Check if the container is running. Uses the canonical container name
 * from the component registry.
 */
function isContainerRunning(containerName = 'hestia-openwebui'): boolean {
  try {
    const out = execSync(
      `docker ps --filter "name=^${containerName}$" --format "{{.Names}}"`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] },
    ).trim();
    return out === containerName;
  } catch {
    return false;
  }
}

/**
 * Wait for OpenWebUI's API to be live by probing `GET /api/version`.
 *
 * `/api/version` is an explicit FastAPI endpoint registered in OWUI's
 * `main.py` and is therefore NOT swallowed by the SvelteKit static-file
 * catch-all. The older `/health` endpoint became SPA-shadowed in OWUI v0.9+
 * (200 OK with HTML body). We confirm a JSON response so that the SPA
 * shell — even if it happens to leak through — is rejected.
 *
 * Polls up to `maxAttempts * 5s` (default 60s).
 */
async function waitUntilHealthy(
  baseUrl: string,
  maxAttempts = 12,
): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`${baseUrl}/api/version`, { signal: controller.signal });
      clearTimeout(timer);
      if (res.ok) {
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('json')) {
          return true;
        }
        // Defensive: if content-type wasn't json, peek at the body. /api/version
        // always returns `{"version":"..."}` on a real OWUI; HTML means we hit
        // the SPA shell — keep waiting.
        const text = await res.text();
        if (!text.trimStart().startsWith('<')) return true;
      }
    } catch {
      // Not ready yet
    }
    await new Promise(r => setTimeout(r, 5_000));
  }
  return false;
}

/**
 * Read WEBUI_SECRET_KEY from OpenWebUI's .env file.
 */
function readWebuiSecretKey(): string | null {
  try {
    const envPath = '/opt/openwebui/.env';
    if (!existsSync(envPath)) return null;
    const content = readFileSync(envPath, 'utf-8');
    const match = content.split('\n').find(l => l.startsWith('WEBUI_SECRET_KEY='));
    return match?.split('=', 2)[1]?.trim() ?? null;
  } catch {
    return null;
  }
}

/**
 * Query OpenWebUI's SQLite DB for the admin user, capturing stderr so a
 * schema/path mismatch on a future OWUI version is visible instead of
 * collapsing into a silent null.
 */
function getAdminUserDetailed(): { user: AdminUser | null; error?: string } {
  try {
    const out = execSync(
      `docker exec hestia-openwebui python3 -c ` +
        `"import sqlite3; r=sqlite3.connect('/app/backend/data/webui.db').execute(\\"SELECT id,email FROM user WHERE role='admin' LIMIT 1\\").fetchone(); ` +
        `print(f'{r[0]}|{r[1]}') if r else print('')"`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
    const row = out.toString().trim();
    if (!row) {
      return { user: null, error: 'admin row not found (no row where role=\'admin\' in user table)' };
    }
    const [id, email] = row.split('|');
    if (!id || !email) return { user: null, error: `unexpected row shape: ${row}` };
    return { user: { id, email } };
  } catch (err: unknown) {
    const stderrBuf = (err as { stderr?: Buffer })?.stderr;
    const stderrStr = stderrBuf?.toString().trim();
    const fallback = err instanceof Error ? err.message : String(err);
    return { user: null, error: `docker exec failed: ${(stderrStr || fallback).slice(0, 300)}` };
  }
}

/** Legacy boolean wrapper for callers that don't care about the stderr. */
function getAdminUser(): AdminUser | null {
  return getAdminUserDetailed().user;
}

/**
 * Forge an admin JWT for OpenWebUI.
 *
 * OWUI's `decode_token()` (backend/open_webui/utils/auth.py) extracts:
 *   - `id`     — REQUIRED, used to look up the user row
 *   - `jti`    — REQUIRED in v0.9+, checked against the Redis revocation list
 *   - `iat`    — issued-at; recorded for revocation checks
 *   - `exp`    — optional; if missing, token doesn't expire
 *
 * `aud` and `iss` are NOT validated. We include `email` for log readability
 * but the middleware ignores it.
 */
function forgeAdminJwt(secretKey: string, admin: AdminUser): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    id: admin.id,
    email: admin.email,
    jti: randomUUID(),
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 300,
  })).toString('base64url');
  const sig = createHmac('sha256', secretKey)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${sig}`;
}

// ── Public API ──

/**
 * Check if OpenWebUI is reachable (health endpoint returns non-HTML).
 * This is a single-shot check with a 5s timeout — no retry loop.
 * Used internally by code paths that manage their own retry budget.
 */
export async function isHealthEndpointReady(hostPort?: number): Promise<boolean> {
  const baseUrl = resolveAdminUrl(hostPort);
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${baseUrl}/health`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return false;
    // Verify it's not HTML (OpenWebUI serves HTML while booting)
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('json') || !contentType.includes('html')) {
      return true;
    }
    const text = await res.text();
    if (!text.trimStart().startsWith('<')) return true;
  } catch {
    return false;
  }
  return false;
}

/**
 * Wait for OpenWebUI health to become ready (single-shot, no retries).
 * Returns true if health passes. Used internally by code paths that
 * manage their own retry budget for the secret key / admin steps.
 */
export async function waitForHealth(hostPort?: number, maxAttempts = 12): Promise<boolean> {
  const baseUrl = resolveAdminUrl(hostPort);
  return waitUntilHealthy(baseUrl, maxAttempts);
}

/**
 * Wait for OpenWebUI health, with structured diagnostics on failure.
 * When the host loopback exhausts its budget, runs an internal probe
 * inside the container so the operator can tell host-port-mapping issues
 * apart from "the app actually isn't ready yet".
 */
export async function waitForHealthDetailed(
  hostPort?: number,
  maxAttempts = 12,
): Promise<{ ok: boolean; reason?: string; baseUrl: string }> {
  const baseUrl = resolveAdminUrl(hostPort);
  let lastErr = '';
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`${baseUrl}/health`, { signal: controller.signal });
      clearTimeout(timer);
      if (res.ok) {
        const ct = res.headers.get('content-type') || '';
        if (ct.includes('json') || !ct.includes('html')) {
          return { ok: true, baseUrl };
        }
        const text = await res.text();
        if (!text.trimStart().startsWith('<')) {
          return { ok: true, baseUrl };
        }
        lastErr = 'OWUI returned HTML at /health (still booting)';
      } else {
        lastErr = `HTTP ${res.status}`;
      }
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
    if (i < maxAttempts - 1) await new Promise(r => setTimeout(r, 5_000));
  }
  // Loopback exhausted — disambiguate via internal probe.
  const internal = probeHealthInternal();
  if (internal.ok) {
    return {
      ok: false,
      baseUrl,
      reason:
        `Host loopback ${baseUrl}/health timed out after ${maxAttempts * 5}s ` +
        `(last error: ${lastErr || 'unknown'}), but the container's own /health responds. ` +
        `Host port mapping is broken — check \`docker port hestia-openwebui 8080\` and \`OPEN_WEBUI_PORT\` in /opt/openwebui/.env.`,
    };
  }
  return {
    ok: false,
    baseUrl,
    reason:
      `Host loopback ${baseUrl}/health timed out after ${maxAttempts * 5}s ` +
      `(last error: ${lastErr || 'unknown'}); internal probe also failed: ${internal.reason ?? 'unknown'}.`,
  };
}

/**
 * Check if OpenWebUI is reachable and get its admin status.
 *
 * Returns:
 *   - 'healthy' + admin user if both container and admin exist
 *   - 'no-admin-user' if container is up but no admin has signed up
 *   - 'not-reachable' if the container is not responding
 *   - 'html-response' if we got HTTP 200 but HTML (still booting)
 */
export async function getStatus(hostPort?: number): Promise<OpenwebuiStatus> {
  const baseUrl = resolveAdminUrl(hostPort);

  const healthy = await waitUntilHealthy(baseUrl, hostPort ? 12 : 6);
  if (!healthy) {
    // Quick check: was it a non-HTML 200 we got?
    try {
      const res = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const text = await res.text();
        if (text.trimStart().startsWith('<')) {
          return { status: 'html-response' };
        }
      }
    } catch { /* not reachable */ }
    return { status: 'not-reachable' };
  }

  const secretKey = readWebuiSecretKey();
  if (!secretKey) {
    return { status: 'no-secret-key' };
  }

  const adminQ = getAdminUserDetailed();
  if (!adminQ.user) {
    return { status: 'no-admin-user', adminUser: null, error: adminQ.error };
  }

  return { status: 'healthy', adminUser: adminQ.user };
}

/**
 * Lightweight status check — no health wait.
 * Assumes health is already passing and only checks secret key + admin user.
 * Used by retry loops that already waited for health upstream.
 */
export async function getAdminReadyStatus(): Promise<OpenwebuiStatus> {
  const secretKey = readWebuiSecretKey();
  if (!secretKey) {
    return { status: 'no-secret-key' };
  }
  const adminQ = getAdminUserDetailed();
  if (!adminQ.user) {
    return { status: 'no-admin-user', adminUser: null, error: adminQ.error };
  }
  return { status: 'healthy', adminUser: adminQ.user };
}

/**
 * Forge an admin JWT. Returns null if we can't get admin user or secret key.
 */
export async function getAdminJwt(hostPort?: number): Promise<string | null> {
  const status = await getStatus(hostPort);

  if (status.status !== 'healthy') return null;

  const secretKey = readWebuiSecretKey();
  if (!secretKey) return null;

  return forgeAdminJwt(secretKey, status.adminUser!);
}

/**
 * Forge an admin JWT, skipping the health wait.
 *
 * Use this when `waitForHealth()` has already confirmed OpenWebUI is
 * healthy — calling `getAdminJwt()` afterwards repeats `waitUntilHealthy`
 * (up to 30 s), which is wasteful and can produce a race-condition failure
 * even though health just passed. This variant goes straight to
 * `getAdminReadyStatus()` (secret key + DB query only).
 */
export async function getAdminJwtPostHealth(): Promise<string | null> {
  const status = await getAdminReadyStatus();
  if (status.status !== 'healthy' || !status.adminUser) return null;
  const secretKey = readWebuiSecretKey();
  if (!secretKey) return null;
  return forgeAdminJwt(secretKey, status.adminUser);
}

/**
 * Post-health JWT acquisition with structured diagnostics. Returns either a
 * usable JWT or a stage+reason that maps directly onto `RegisterStage`.
 */
export async function getAdminJwtPostHealthDetailed(): Promise<
  | { ok: true; jwt: string }
  | { ok: false; stage: 'secret-key' | 'admin-row'; reason: string }
> {
  const status = await getAdminReadyStatus();
  if (status.status === 'no-secret-key') {
    return { ok: false, stage: 'secret-key', reason: 'WEBUI_SECRET_KEY missing in /opt/openwebui/.env' };
  }
  if (status.status !== 'healthy' || !status.adminUser) {
    const reason = status.status === 'no-admin-user'
      ? (status.error ?? 'admin user not found in user table')
      : `unexpected status: ${status.status}`;
    return { ok: false, stage: 'admin-row', reason };
  }
  const secretKey = readWebuiSecretKey();
  if (!secretKey) {
    return { ok: false, stage: 'secret-key', reason: 'WEBUI_SECRET_KEY missing in /opt/openwebui/.env' };
  }
  return { ok: true, jwt: forgeAdminJwt(secretKey, status.adminUser) };
}

/**
 * One-shot probe of OpenWebUI's admin API with the supplied JWT. Used by
 * `registerOpenwebuiAdminApi` to surface stage='jwt-rejected' (401/403)
 * separately from generic reconcile failures.
 */
export async function probeAdminAuth(
  jwt: string,
  hostPort?: number,
): Promise<{ ok: boolean; status: number; body: string }> {
  const baseUrl = resolveAdminUrl(hostPort);
  try {
    // Probe an admin-gated endpoint that's explicitly registered in v0.9.4
    // (so it can't be shadowed by the SPA catch-all). `/api/v1/configs/export`
    // requires admin auth — a 401/403 here is unambiguous JWT-rejection.
    const res = await fetch(`${baseUrl}/api/v1/configs/export`, {
      headers: { Authorization: `Bearer ${jwt}` },
      signal: AbortSignal.timeout(8000),
    });
    const body = await res.text();
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    return { ok: false, status: 0, body: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Read the current OpenWebUI config via admin API.
 * Returns null if the API is unreachable or auth fails.
 */
export async function getConfig(jwt: string, hostPort?: number): Promise<OpenWebuiConfig | null> {
  const detailed = await getConfigDetailed(jwt, hostPort);
  return detailed.ok ? detailed.config : null;
}

/**
 * Read the current OpenWebUI persisted config via the admin export endpoint.
 *
 * v0.9.4 split the old `GET /api/v1/configs/` (which now returns the SPA
 * shell) into per-resource sub-routes. The closest equivalent for "give me
 * the full snapshot so I can reconcile" is `GET /api/v1/configs/export`.
 * Source: `backend/open_webui/routers/configs.py` at v0.9.4.
 */
export async function getConfigDetailed(
  jwt: string,
  hostPort?: number,
): Promise<
  | { ok: true; config: OpenWebuiConfig }
  | { ok: false; status: number; bodyPreview: string; reason: string }
> {
  const baseUrl = resolveAdminUrl(hostPort);
  let status = 0;
  let body = '';
  try {
    const res = await fetch(`${baseUrl}/api/v1/configs/export`, {
      headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    });
    status = res.status;
    body = await res.text();
    if (!res.ok) {
      return { ok: false, status, bodyPreview: body.slice(0, 200), reason: `HTTP ${status}` };
    }
    if (body.trimStart().startsWith('<')) {
      return {
        ok: false,
        status,
        bodyPreview: body.slice(0, 200),
        reason: 'OWUI returned HTML at /api/v1/configs/export (admin endpoint not registered or SPA shell intercepted the request)',
      };
    }
    try {
      const config = JSON.parse(body) as OpenWebuiConfig;
      return { ok: true, config };
    } catch (err) {
      return {
        ok: false,
        status,
        bodyPreview: body.slice(0, 200),
        reason: `JSON parse failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  } catch (err) {
    return {
      ok: false,
      status,
      bodyPreview: body.slice(0, 200),
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Save OpenWebUI config via admin API.
 * Returns true if the save succeeded.
 */
export async function saveConfig(
  jwt: string,
  config: OpenWebuiConfig,
  hostPort?: number,
): Promise<boolean> {
  const detailed = await saveConfigDetailed(jwt, config, hostPort);
  return detailed.ok;
}

/**
 * Save OpenWebUI persisted config via the admin import endpoint.
 *
 * v0.9.4: `POST /api/v1/configs/import` accepts `{ config: <full snapshot> }`.
 * Source: `backend/open_webui/routers/configs.py` at v0.9.4.
 */
export async function saveConfigDetailed(
  jwt: string,
  config: OpenWebuiConfig,
  hostPort?: number,
): Promise<
  | { ok: true }
  | { ok: false; status: number; bodyPreview: string; reason: string }
> {
  const baseUrl = resolveAdminUrl(hostPort);
  let status = 0;
  let body = '';
  try {
    const res = await fetch(`${baseUrl}/api/v1/configs/import`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ config }),
    });
    status = res.status;
    if (res.ok) return { ok: true };
    body = await res.text();
    return { ok: false, status, bodyPreview: body.slice(0, 200), reason: `HTTP ${status}` };
  } catch (err) {
    return {
      ok: false,
      status,
      bodyPreview: body.slice(0, 200),
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * List currently registered pipelines.
 * Returns an empty array if the API is unreachable.
 */
export async function listPipelines(jwt: string, hostPort?: number): Promise<PipelineRegistration[]> {
  const baseUrl = resolveAdminUrl(hostPort);
  try {
    const res = await fetch(`${baseUrl}/api/v1/pipelines`, {
      headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    });
    if (!res.ok) return [];
    const text = await res.text();
    if (text.trimStart().startsWith('<')) return [];
    const data = JSON.parse(text);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/**
 * Register a pipelines sidecar. Idempotent — checks if already registered.
 *
 * @returns true if registered (or already registered), false on error
 */
export async function registerPipeline(
  jwt: string,
  pipelinesUrl: string,
  pipelinesKey: string,
  hostPort?: number,
): Promise<boolean> {
  const baseUrl = resolveAdminUrl(hostPort);

  // Check if already registered
  const existing = await listPipelines(jwt, hostPort);
  if (existing.some(p => p.url === pipelinesUrl)) {
    return true; // already registered
  }

  try {
    const res = await fetch(`${baseUrl}/api/v1/pipelines/add`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: pipelinesUrl, key: pipelinesKey }),
    });
    if (res.ok) return true;
    // Some versions return "already registered" in the detail
    const body = await res.json().catch(() => ({}));
    if (String(body.detail ?? '').toLowerCase().includes('already')) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * Model source entry — a single AI backend that OpenWebUI can call.
 */
export interface ModelSource {
  /** OpenAI-compat base URL, e.g. "http://eve-brain-synap:4000/v1" */
  url: string;
  /** API key for authenticating to the backend */
  apiKey: string;
  /** Display name shown in the model picker, e.g. "Synap IS" */
  displayName: string;
  /**
   * Model identifiers to expose in the picker.
   * When omitted, the models list is fetched from the backend's /v1/models
   * endpoint on demand.
   */
  models?: string[];
}

/**
 * Model source metadata as stored in OpenWebUI's config under
 * `config.openai.metadata[<url>]`.
 */
export interface ModelSourceMetadata {
  name: string;
  /** e.g. "synap/auto;synap/balanced" */
  models?: string;
}

// ── Model Source Management ──

const MANAGED_ROOT_KEY_BY_OPTION = {
  webuiUrl: 'WEBUI_URL',
  webuiName: 'WEBUI_NAME',
  enableSignup: 'ENABLE_SIGNUP',
  defaultUserRole: 'DEFAULT_USER_ROLE',
} as const satisfies Record<Exclude<keyof OpenWebuiManagedConfig, 'modelSources' | 'defaultModels'>, string>;

const DEFAULT_MODELS_KEYS = ['DEFAULT_MODELS', 'default_models'] as const;

function isPlainConfigObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function modelSourceMetadataFor(modelSource: ModelSource): ModelSourceMetadata {
  return {
    name: modelSource.displayName,
    models: modelSource.models?.join(';'),
  };
}

function defaultModelsForExistingShape(
  desired: OpenWebuiDefaultModels,
  existing: unknown,
): OpenWebuiDefaultModels {
  if (Array.isArray(existing)) {
    return Array.isArray(desired) ? [...desired] : [desired];
  }
  return Array.isArray(desired) ? desired.join(',') : desired;
}

function setIfChanged(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
  changedKeys: Set<string>,
): void {
  if (JSON.stringify(target[key]) === JSON.stringify(value)) return;
  target[key] = value;
  changedKeys.add(key);
}

/**
 * Reconcile Eve-managed OpenWebUI persisted config while preserving unrelated
 * OpenWebUI and user-owned settings.
 *
 * This helper only owns:
 *   - config.openai.api_base_urls/api_keys/metadata entries for supplied sources
 *   - DEFAULT_MODELS/default_models
 *   - WEBUI_URL, WEBUI_NAME, ENABLE_SIGNUP, DEFAULT_USER_ROLE
 *
 * Existing model sources not supplied by Eve remain in place. OpenAI keys are
 * aligned by URL and padded to OpenWebUI's expected array shape.
 */
export function reconcileOpenwebuiManagedConfig(
  currentConfig: OpenWebuiConfig,
  desired: OpenWebuiManagedConfig,
): OpenWebuiConfigReconcileResult {
  const config: OpenWebuiConfig = { ...currentConfig };
  const changedKeys = new Set<string>();

  if (desired.modelSources?.length) {
    const existingOpenai = isPlainConfigObject(config.openai) ? config.openai : {};
    const openai: Record<string, unknown> = { ...existingOpenai };
    const urls = Array.isArray(openai.api_base_urls) ? [...openai.api_base_urls] : [];
    const keys = Array.isArray(openai.api_keys) ? [...openai.api_keys] : [];
    const existingMetadata = isPlainConfigObject(openai.metadata) ? openai.metadata : {};
    const metadata: Record<string, ModelSourceMetadata> = { ...existingMetadata } as Record<string, ModelSourceMetadata>;

    for (const modelSource of desired.modelSources) {
      const idx = urls.indexOf(modelSource.url);
      if (idx === -1) {
        urls.push(modelSource.url);
        keys.push(modelSource.apiKey);
      } else {
        keys[idx] = modelSource.apiKey;
      }
      metadata[modelSource.url] = modelSourceMetadataFor(modelSource);
    }

    while (keys.length < urls.length) keys.push('');

    setIfChanged(openai, 'api_base_urls', urls, changedKeys);
    setIfChanged(openai, 'api_keys', keys, changedKeys);
    setIfChanged(openai, 'metadata', metadata, changedKeys);

    if (JSON.stringify(config.openai) !== JSON.stringify(openai)) {
      config.openai = openai as OpenWebuiConfig['openai'];
      changedKeys.add('openai');
    }
  }

  if (desired.defaultModels !== undefined) {
    const existingKeys = DEFAULT_MODELS_KEYS.filter(key => key in config);
    const keysToSet: readonly string[] = existingKeys.length ? existingKeys : ['DEFAULT_MODELS'];
    for (const key of keysToSet) {
      setIfChanged(
        config,
        key,
        defaultModelsForExistingShape(desired.defaultModels, config[key]),
        changedKeys,
      );
    }
  }

  for (const [optionKey, configKey] of Object.entries(MANAGED_ROOT_KEY_BY_OPTION)) {
    const value = desired[optionKey as keyof typeof MANAGED_ROOT_KEY_BY_OPTION];
    if (value !== undefined) {
      setIfChanged(config, configKey, value, changedKeys);
    }
  }

  return {
    config,
    changed: changedKeys.size > 0,
    changedKeys: [...changedKeys],
  };
}

/**
 * Read OpenWebUI persisted config, reconcile Eve-managed fields, and save the
 * merged result. Returns null when the admin API cannot be read or written.
 */
export async function reconcileOpenwebuiManagedConfigViaAdmin(
  jwt: string,
  desired: OpenWebuiManagedConfig,
  hostPort?: number,
): Promise<OpenWebuiConfigReconcileResult | null> {
  const detailed = await reconcileOpenwebuiManagedConfigViaAdminDetailed(jwt, desired, hostPort);
  return detailed.ok ? detailed.result : null;
}

/**
 * Detailed variant: returns which sub-step failed (`getConfig` or `saveConfig`)
 * along with the OWUI HTTP status and a body preview. Used by
 * `registerOpenwebuiAdminApi` to surface concrete `stage='reconcile'` reasons
 * instead of the opaque "returned null" message.
 */
export async function reconcileOpenwebuiManagedConfigViaAdminDetailed(
  jwt: string,
  desired: OpenWebuiManagedConfig,
  hostPort?: number,
): Promise<
  | { ok: true; result: OpenWebuiConfigReconcileResult }
  | { ok: false; step: 'getConfig' | 'saveConfig'; status: number; bodyPreview: string; reason: string }
> {
  const read = await getConfigDetailed(jwt, hostPort);
  if (!read.ok) {
    return { ok: false, step: 'getConfig', status: read.status, bodyPreview: read.bodyPreview, reason: read.reason };
  }

  const result = reconcileOpenwebuiManagedConfig(read.config, desired);
  if (!result.changed) return { ok: true, result };

  const save = await saveConfigDetailed(jwt, result.config, hostPort);
  if (!save.ok) {
    return { ok: false, step: 'saveConfig', status: save.status, bodyPreview: save.bodyPreview, reason: save.reason };
  }
  return { ok: true, result };
}

/**
 * List all model sources currently configured in OpenWebUI.
 * Returns an empty array if the API is unreachable.
 */
export async function listModelSources(jwt: string, hostPort?: number): Promise<ModelSource[]> {
  const config = await getConfig(jwt, hostPort);
  if (!config) return [];

  const openai = (config.openai ?? {}) as Record<string, unknown>;
  const urls: string[] = Array.isArray(openai.api_base_urls) ? openai.api_base_urls : [];
  const keys: string[] = Array.isArray(openai.api_keys) ? openai.api_keys : [];
  const metadata: Record<string, ModelSourceMetadata> = (openai.metadata ?? {}) as Record<string, ModelSourceMetadata>;

  return urls.map((url, i) => ({
    url,
    apiKey: keys[i] ?? '',
    displayName: metadata[url]?.name ?? url,
  }));
}

/**
 * Register a single model source in OpenWebUI's persisted config.
 *
 * Writes to config.openai (api_base_urls + api_keys + metadata). This is
 * sufficient for the source to appear in the model picker — OpenWebUI fetches
 * /v1/models from each registered URL automatically.
 *
 * Note: /api/v1/pipelines/add is for the Python pipelines sidecar only;
 * it must NOT be called for OpenAI-compatible model sources.
 *
 * Idempotent — skips if the URL is already registered with the same key.
 * Returns true if registered (or already up-to-date), false on error.
 */
export async function registerModelSource(
  jwt: string,
  modelSource: ModelSource,
  hostPort?: number,
): Promise<boolean> {
  const result = await reconcileOpenwebuiManagedConfigViaAdmin(
    jwt,
    { modelSources: [modelSource] },
    hostPort,
  );
  return result !== null;
}

/**
 * Bulk upsert all model sources in a single atomic config POST.
 *
 * Returns the count of sources written (modelSources.length) on success, 0 on
 * error. Does not call /api/v1/pipelines/add — that endpoint is for the Python
 * pipelines sidecar, not for OpenAI-compatible model source registration.
 */
export async function upsertAllModelSources(
  jwt: string,
  modelSources: ModelSource[],
  hostPort?: number,
): Promise<number> {
  if (modelSources.length === 0) return 0;

  const result = await reconcileOpenwebuiManagedConfigViaAdmin(
    jwt,
    { modelSources },
    hostPort,
  );
  return result !== null ? modelSources.length : 0;
}
