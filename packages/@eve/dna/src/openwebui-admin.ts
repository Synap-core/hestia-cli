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
 * Lightweight status check — no health wait.
 * Assumes health is already passing and only checks secret key + admin user.
 * Used by retry loops that already waited for health upstream.
 */
export async function getAdminReadyStatus(): Promise<OpenwebuiStatus> {
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
  const config = await getConfig(jwt, hostPort);
  if (!config) return null;

  const result = reconcileOpenwebuiManagedConfig(config, desired);
  if (!result.changed) return result;

  if (!await saveConfig(jwt, result.config, hostPort)) return null;
  return result;
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
 * Register a single model source as both:
 *   1. An OpenWebUI config entry (api_base_urls + api_keys + metadata)
 *   2. A manifold pipeline in /api/v1/pipelines — so it appears in the model
 *      picker with a proper display name and model list.
 *
 * OpenWebUI manifold pipelines accept:
 *   - `type: "manifold"` — exposes custom models in the selector
 *   - `inlet` hook — runs before every chat, can transform the request
 *
 * Idempotent — skips if the URL is already registered.
 *
 * Returns true if registered (or already registered), false on error.
 */
export async function registerModelSource(
  jwt: string,
  modelSource: ModelSource,
  hostPort?: number,
): Promise<boolean> {
  // 1. Upsert into config.openai
  const result = await reconcileOpenwebuiManagedConfigViaAdmin(
    jwt,
    { modelSources: [modelSource] },
    hostPort,
  );
  if (!result) return false;

  // 2. Register as manifold pipeline (for model picker visibility)
  return registerManifoldPipeline(jwt, modelSource, hostPort);
}

/**
 * Register a manifold pipeline in OpenWebUI so the model source appears
 * in the model picker with its display name and model list.
 *
 * OpenWebUI manifold pipelines expose models under a custom namespace
 * (e.g. "synap/auto", "synap/balanced") in the chat model selector.
 *
 * The manifold payload sent to /pipelines/add:
 *   {
 *     uid: "<url>",           // unique ID (the URL serves as the namespace)
 *     name: "<displayName>",  // shown in picker
 *     type: "manifold",
 *     hook: "inlet",
 *     models: [...]           // model list (omitted = auto-fetched from /v1/models)
 *   }
 */
async function registerManifoldPipeline(
  jwt: string,
  modelSource: ModelSource,
  hostPort?: number,
): Promise<boolean> {
  const baseUrl = resolveAdminUrl(hostPort);

  // Check if already registered
  const existing = await listPipelines(jwt, hostPort);
  if (existing.some(p => p.pipelines?.[0]?.uid === modelSource.url)) {
    return true; // already registered
  }

  const pipelineDef: PipelineRegistration = {
    url: modelSource.url,
    name: modelSource.displayName,
    pipelines: [{
      uid: modelSource.url,
      name: modelSource.displayName,
      description: `Model source: ${modelSource.url}`,
      type: 'manifold',
      hook: 'inlet',
      ...(modelSource.models?.length ? { models: modelSource.models } : {}),
    }],
  };

  try {
    const res = await fetch(`${baseUrl}/api/v1/pipelines/add`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(pipelineDef),
    });
    if (res.ok) return true;
    const body = await res.json().catch(() => ({}));
    if (String(body.detail ?? '').toLowerCase().includes('already')) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * Bulk upsert all model sources. Writes all URLs, keys, and metadata
 * in a single config POST (atomic), then registers each as a manifold
 * pipeline (best-effort — individual failures don't roll back the config).
 *
 * Returns the count of model sources successfully registered.
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
  if (!result) return 0;

  // Register each as manifold pipeline (best-effort)
  let registered = 0;
  for (const ms of modelSources) {
    if (await registerManifoldPipeline(jwt, ms, hostPort)) {
      registered++;
    }
  }

  return registered;
}
