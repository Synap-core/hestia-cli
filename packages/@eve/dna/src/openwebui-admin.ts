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
const { createHmac } = require('node:crypto');

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
  };
  // Other config keys may exist
  [key: string]: unknown;
}

export type OpenwebuiStatus =
  | { status: 'healthy'; adminUser: AdminUser | null }
  | { status: 'no-admin-user'; adminUser: null }
  | { status: 'not-reachable' }
  | { status: 'no-secret-key' }
  | { status: 'html-response' }; // Got HTTP 200 but HTML, not JSON

// ── Constants ──

// ── Helpers ──

/**
 * Resolve the base URL for OpenWebUI's admin API on the host.
 * Uses the component registry for the correct port.
 */
function resolveAdminUrl(hostPort?: number): string {
  const comp = COMPONENTS.find(c => c.id === 'openwebui');
  const port = hostPort ?? comp?.service?.hostPort ?? 3011;
  return `http://127.0.0.1:${port}`;
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
 * Wait for OpenWebUI to be healthy (HTTP 200 returning JSON, not HTML).
 * Polls up to `maxAttempts * 5s` (default 60s).
 *
 * Returns true if the health endpoint is reachable AND returns a non-HTML response.
 */
async function waitUntilHealthy(
  baseUrl: string,
  maxAttempts = 12,
): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`${baseUrl}/health`, { signal: controller.signal });
      clearTimeout(timer);
      if (res.ok) {
        // Verify it's not HTML (OpenWebUI serves HTML while booting)
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('json') || !contentType.includes('html')) {
          return true;
        }
        // Check body for HTML tag
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
 * Query OpenWebUI's SQLite DB for the admin user.
 */
function getAdminUser(): AdminUser | null {
  try {
    const row = execSync(
      `docker exec hestia-openwebui python3 -c ` +
        `"import sqlite3; r=sqlite3.connect('/app/backend/data/webui.db').execute(\\"SELECT id,email FROM user WHERE role='admin' LIMIT 1\\").fetchone(); " +
        "print(f'{r[0]}|{r[1]}') if r else print('')"`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] },
    ).trim();
    if (!row) return null;
    const [id, email] = row.split('|');
    if (!id || !email) return null;
    return { id, email };
  } catch {
    return null;
  }
}

/**
 * Forge an admin JWT for OpenWebUI.
 *
 * OpenWebUI accepts a JWT with {id, email, role: "admin"} claims
 * signed with WEBUI_SECRET_KEY (HS256).
 */
function forgeAdminJwt(secretKey: string, admin: AdminUser): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    id: admin.id,
    email: admin.email,
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

  const admin = getAdminUser();
  if (!admin) {
    return { status: 'no-admin-user', adminUser: null };
  }

  return { status: 'healthy', adminUser: admin };
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
 * Read the current OpenWebUI config via admin API.
 * Returns null if the API is unreachable or auth fails.
 */
export async function getConfig(jwt: string, hostPort?: number): Promise<OpenWebuiConfig | null> {
  const baseUrl = resolveAdminUrl(hostPort);
  try {
    const res = await fetch(`${baseUrl}/api/v1/configs/`, {
      headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    });
    if (!res.ok) return null;
    const text = await res.text();
    if (text.trimStart().startsWith('<')) return null; // HTML response
    return JSON.parse(text) as OpenWebuiConfig;
  } catch {
    return null;
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
  const baseUrl = resolveAdminUrl(hostPort);
  try {
    const res = await fetch(`${baseUrl}/api/v1/configs/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    return res.ok;
  } catch {
    return false;
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
 * Add or update a model source in the OpenWebUI config.
 *
 * OpenWebUI stores model sources in: config.openai.api_base_urls[] + api_keys[]
 * URLs and keys are parallel arrays of the same length.
 *
 * Returns true if the config was updated and saved successfully.
 */
export async function upsertModelSource(
  jwt: string,
  url: string,
  apiKey: string,
  hostPort?: number,
): Promise<boolean> {
  const config = await getConfig(jwt, hostPort);
  if (!config) return false;

  const openai = (config.openai ?? {}) as Record<string, unknown>;
  const urls: string[] = Array.isArray(openai.api_base_urls) ? [...openai.api_base_urls] : [];
  const keys: string[] = Array.isArray(openai.api_keys) ? [...openai.api_keys] : [];

  const idx = urls.indexOf(url);
  if (idx === -1) {
    urls.push(url);
    keys.push(apiKey);
  } else {
    keys[idx] = apiKey;
  }

  // Pad keys to match URLs length
  while (keys.length < urls.length) keys.push('');

  openai.api_base_urls = urls;
  openai.api_keys = keys;
  config.openai = openai;

  return saveConfig(jwt, config, hostPort);
}
