/**
 * Centralized AI provider wiring for Eve components.
 *
 * Single source of truth: `secrets.ai.providers[]`. Every component that
 * consumes AI (Synap IS, OpenClaw, Open WebUI, Hermes/OpenCode/OpenClaude)
 * derives its config from there via `wireComponentAi(id, secrets)`.
 *
 * Key architectural choice: **Synap IS is the AI hub**. Other components
 * are wired to use IS as their OpenAI-compat backend. Only Synap IS holds
 * upstream provider keys (OpenAI, Anthropic, OpenRouter). That collapses
 * the multi-component wiring problem to one place.
 *
 * Effects of wiring:
 *   - Writes a config file on the host or inside a container
 *   - Optionally restarts the affected container so changes take effect
 *
 * Caller is responsible for catching errors and reporting per-component.
 */

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import type { EveSecrets } from './secrets-contract.js';
import { readAgentKeyOrLegacySync } from './secrets-contract.js';
import { COMPONENTS } from './components.js';
import { writeHermesConfigYamlSync, generateSynapPlugin } from './builder-hub-wiring.js';
import { syncOpenwebuiExtras } from './openwebui-extras.js';
import {
  getAdminJwt,
  getAdminJwtPostHealth,
  reconcileOpenwebuiManagedConfigViaAdmin,
  registerPipeline,
  waitForHealth,
  type ModelSource,
  type OpenWebuiManagedConfig,
} from './openwebui-admin.js';

export interface WireAiResult {
  /** Component id this result is for. */
  id: string;
  /** ok | skipped | failed. */
  outcome: 'ok' | 'skipped' | 'failed';
  /** One-line summary suitable for spinner.succeed/skip/fail. */
  summary: string;
  /** Optional detail (file path written, error message, etc). */
  detail?: string;
}

/** True if a container with the given name is running. */
function isContainerRunning(name: string): boolean {
  try {
    const out = execSync(`docker ps --filter "name=^${name}$" --format "{{.Names}}"`, {
      encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();
    return out === name;
  } catch {
    return false;
  }
}

/** Restart a docker container, swallowing errors (caller decides what to do). */
function dockerRestart(name: string): void {
  try {
    execSync(`docker restart ${name}`, { stdio: 'ignore' });
  } catch { /* non-fatal */ }
}

/**
 * Pick the AI provider entry that drives a given component.
 *
 * Resolution: per-service override (`ai.serviceProviders[componentId]`)
 * → global `defaultProvider` → first enabled → first present.
 *
 * Only providers with an apiKey (or `ollama`, which doesn't need one) are
 * considered. `componentId` is optional: when omitted we fall back to the
 * global rule so callers that don't care about per-service stay simple.
 */
export function pickPrimaryProvider(
  secrets: EveSecrets | null,
  componentId?: string,
) {
  // All providers unified — built-in + custom merged
  const all = (secrets?.ai?.providers ?? [])
    .filter(p => p.enabled !== false);
  const usable = all.filter(p =>
    p.id === 'ollama' || (p.apiKey && p.apiKey.trim().length > 0) ||
    (p.baseUrl && p.baseUrl.trim().length > 0),  // custom providers may not have API keys
  );
  if (usable.length === 0) return null;

  // 1. Per-service override
  let base = null;
  if (componentId) {
    const override = secrets?.ai?.serviceProviders?.[componentId];
    if (override) {
      const hit = usable.find(p => p.id === override);
      if (hit) base = hit;
      // Override points at a provider with no key → fall through to default.
    }
  }

  // 2. Global default, then fallback
  if (!base) {
    const def = secrets?.ai?.defaultProvider;
    const fallback = secrets?.ai?.fallbackProvider;
    base = (
      usable.find(p => p.id === def) ??
      usable.find(p => p.id === fallback) ??
      usable.find(p => p.enabled !== false) ??
      usable[0]
    );
  }

  if (!base) return null;

  // 3. Per-service model override: replace defaultModel without changing provider
  if (componentId) {
    const modelOverride = secrets?.ai?.serviceModels?.[componentId];
    if (modelOverride) {
      return { ...base, defaultModel: modelOverride };
    }
  }

  return base;
}

// ───────────────────────────────────────────────────────────────────────────
// Per-component wiring
// ───────────────────────────────────────────────────────────────────────────

/**
 * Synap IS receives the upstream provider keys directly. It exposes a single
 * OpenAI-compat endpoint that other components route through.
 *
 * Writes /opt/synap-backend/deploy/.env (or SYNAP_DEPLOY_DIR) with all
 * provider keys, then restarts the IS container.
 */
function wireSynapIs(secrets: EveSecrets | null): WireAiResult {
  const providers = secrets?.ai?.providers ?? [];
  if (providers.length === 0) {
    return { id: 'synap', outcome: 'skipped', summary: 'no AI providers configured' };
  }

  const deployDir = process.env.SYNAP_DEPLOY_DIR ?? '/opt/synap-backend/deploy';
  if (!existsSync(deployDir)) {
    return { id: 'synap', outcome: 'skipped', summary: `deploy dir not found: ${deployDir}` };
  }

  // Build env additions for each provider that has a key.
  const envLines: string[] = ['# AI provider keys — managed by eve ai apply'];
  for (const p of providers) {
    if (!p.apiKey) continue;
    // Built-in provider keys (by id)
    if (p.id === 'openai') envLines.push(`OPENAI_API_KEY=${p.apiKey}`);
    if (p.id === 'anthropic') envLines.push(`ANTHROPIC_API_KEY=${p.apiKey}`);
    if (p.id === 'openrouter') envLines.push(`OPENROUTER_API_KEY=${p.apiKey}`);
    // Custom provider keys — write as generic env vars
    if (p.id.startsWith('custom-') || !['ollama', 'openai', 'anthropic', 'openrouter'].includes(p.id)) {
      const idx = providers.filter(x => x.id.startsWith('custom-')).indexOf(p) + 1;
      if (idx > 0) {
        envLines.push(`CUSTOM_PROVIDER_${idx}_BASE_URL=${p.baseUrl ?? ''}`);
        envLines.push(`CUSTOM_PROVIDER_${idx}_API_KEY=${p.apiKey}`);
        envLines.push(`CUSTOM_PROVIDER_${idx}_NAME=${p.name ?? p.id}`);
        if (p.defaultModel) envLines.push(`CUSTOM_PROVIDER_${idx}_DEFAULT_MODEL=${p.defaultModel}`);
      }
    }
  }
  // Honor per-service override for synap itself: when the user has
  // configured "use Anthropic for Synap IS", DEFAULT_AI_PROVIDER reflects
  // that choice. Keeps the resolution rule consistent across all
  // wire* functions (they all call pickPrimaryProvider with their id).
  const synapProvider = pickPrimaryProvider(secrets, 'synap');
  if (synapProvider) {
    envLines.push(`DEFAULT_AI_PROVIDER=${synapProvider.id}`);
    if (synapProvider.defaultModel) {
      envLines.push(`DEFAULT_AI_MODEL=${synapProvider.defaultModel}`);
    }
  }

  // Expose Ollama internal URL so the backend's /v1/models can discover
  // locally-running models dynamically (no restart needed — env is read once
  // at boot and cached; model list fetched fresh per /v1/models request).
  const ollamaProvider = providers.find(p => p.id === 'ollama');
  if (ollamaProvider) {
    const ollamaUrl = secrets?.inference?.ollamaUrl ?? 'http://eve-brain-ollama:11434';
    envLines.push(`OLLAMA_BASE_URL=${ollamaUrl}`);
  }

  // Append to existing .env, replacing any prior eve-managed block
  const envPath = join(deployDir, '.env');
  let existing = '';
  try {
    existing = readFileSync(envPath, 'utf-8');
  } catch { /* missing — start fresh */ }

  // Strip any previous eve-managed block (everything from our marker to the end of that section)
  const marker = '# AI provider keys — managed by eve ai apply';
  const before = existing.includes(marker) ? existing.split(marker)[0].trimEnd() : existing.trimEnd();
  const merged = (before ? before + '\n\n' : '') + envLines.join('\n') + '\n';

  try {
    writeFileSync(envPath, merged, { mode: 0o600 });
  } catch (err) {
    return {
      id: 'synap',
      outcome: 'failed',
      summary: 'could not write Synap IS env',
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  // Restart the Synap IS container if it's running
  // (synap-backend's intelligence-hub service — find by compose label)
  try {
    const out = execSync(
      `docker ps --filter "label=com.docker.compose.project=synap-backend" --filter "label=com.docker.compose.service=intelligence-hub" --format "{{.Names}}"`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] },
    ).trim();
    const isContainer = out.split('\n')[0]?.trim();
    if (isContainer) dockerRestart(isContainer);
  } catch { /* IS may not be running — that's ok */ }

  return {
    id: 'synap',
    outcome: 'ok',
    summary: `Synap IS env updated (${providers.length} provider(s))`,
    detail: envPath,
  };
}

/**
 * OpenClaw uses a JSON auth store inside the container at
 * `/home/node/.openclaw/agents/main/agent/auth-profiles.json`. We write it
 * via `docker exec`, pointing OpenClaw at Synap IS as its OpenAI-compat
 * backend. The Synap pod API key authenticates IS — IS routes to the real
 * upstream provider configured above.
 */
function wireOpenclaw(secrets: EveSecrets | null): WireAiResult {
  // OpenClaw authenticates to Synap IS as the `openclaw` agent — its own
  // user, scopes, and audit trail. Falls back to the legacy single key
  // for installs that haven't yet been migrated to per-agent.
  const synapApiKey = readAgentKeyOrLegacySync('openclaw', secrets);
  if (!synapApiKey) {
    return { id: 'openclaw', outcome: 'skipped', summary: 'no Synap pod API key — install Synap first' };
  }
  if (!isContainerRunning('eve-arms-openclaw')) {
    return { id: 'openclaw', outcome: 'skipped', summary: 'eve-arms-openclaw container not running' };
  }

  // OpenClaw's auth store format. Default agent is "main".
  // Per-service override: when the user has chosen e.g. "use Anthropic
  // for OpenClaw", we pass that provider's `defaultModel` as the
  // preferred model. OpenClaw still routes through Synap IS — IS picks
  // the matching upstream provider based on the model name.
  const provider = pickPrimaryProvider(secrets, 'openclaw');
  const preferredModel = provider?.defaultModel;

  const authProfile = {
    providers: {
      openai: {
        apiKey: synapApiKey,
        // Synap backend (eve-brain-synap:4000) is the AI hub for self-hosted Eve.
        // intelligence-hub:3001 is the proprietary IS — not available without managed pod.
        baseUrl: 'http://eve-brain-synap:4000/v1',
        ...(preferredModel ? { defaultModel: preferredModel } : {}),
      },
    },
    ...(preferredModel ? { defaultModel: preferredModel } : {}),
  };
  const authJson = JSON.stringify(authProfile, null, 2);
  const containerPath = '/home/node/.openclaw/agents/main/agent/auth-profiles.json';

  try {
    // Ensure the directory exists, then pipe the JSON in via docker exec
    execSync(`docker exec eve-arms-openclaw sh -c 'mkdir -p ${dirname(containerPath)}'`, {
      stdio: 'ignore',
    });
    execSync(
      `docker exec -i eve-arms-openclaw sh -c 'cat > ${containerPath}'`,
      { input: authJson, stdio: ['pipe', 'pipe', 'ignore'] },
    );
    execSync(`docker exec eve-arms-openclaw sh -c 'chmod 600 ${containerPath}'`, {
      stdio: 'ignore',
    });
  } catch (err) {
    return {
      id: 'openclaw',
      outcome: 'failed',
      summary: 'could not write OpenClaw auth-profiles.json',
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  // Restart so the agent loop picks up the new auth
  dockerRestart('eve-arms-openclaw');

  return {
    id: 'openclaw',
    outcome: 'ok',
    summary: 'OpenClaw wired to Synap IS as OpenAI provider',
    detail: containerPath,
  };
}

/**
 * Open WebUI reads OPENAI_API_BASE_URL + OPENAI_API_KEY from its .env. We
 * point it at Synap IS so all chats route through the IS hub.
 *
 * The .env file is written before `docker compose up -d` which recreates the
 * container. OpenWebUI reads the env vars on boot and seeds the DB — no admin
 * API needed for model-source wiring.
 */
function wireOpenwebui(secrets: EveSecrets | null): WireAiResult {
  // OpenWebUI's OPENAI_API_KEY is what the chat UI uses to call Synap IS.
  // When Pipelines is installed, its agent identity is the right one
  // (channels sync + memory inject originate there). With no pipelines,
  // we still use the openwebui-pipelines slot — its key is the
  // canonical "OpenWebUI talking to Synap" identity. Falls back to
  // legacy if the per-agent record isn't there yet.
  const synapApiKey = readAgentKeyOrLegacySync('openwebui-pipelines', secrets);
  if (!synapApiKey) {
    return { id: 'openwebui', outcome: 'skipped', summary: 'no Synap pod API key — install Synap first' };
  }

  const providers = secrets?.ai?.providers ?? [];
  const deployDir = '/opt/openwebui';
  const envPath = join(deployDir, '.env');
  if (!existsSync(deployDir)) {
    return { id: 'openwebui', outcome: 'skipped', summary: 'Open WebUI deploy dir not found — install it first' };
  }

  // Read existing, replace eve-managed block
  let existing = '';
  try {
    existing = readFileSync(envPath, 'utf-8');
  } catch { /* missing */ }

  const marker = '# AI wiring — managed by eve ai apply';
  const aiManagedEnvKeys = new Set([
    'SYNAP_API_KEY',
    'SYNAP_IS_URL',
    'OPENAI_API_BASE_URLS',
    'OPENAI_API_KEYS',
    'DEFAULT_MODELS',
  ]);
  const rawBefore = existing.includes(marker) ? existing.split(marker)[0] : existing;
  const before = rawBefore
    .split('\n')
    .filter(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) return true;
      const key = trimmed.slice(0, trimmed.indexOf('='));
      return !aiManagedEnvKeys.has(key);
    })
    .join('\n')
    .trimEnd();

  // Per-service override: Open WebUI lets users pick models in the UI,
  // but `DEFAULT_MODELS` populates the default selection — so honoring
  // the override here means the user's "use OpenAI for Open WebUI"
  // choice surfaces as the preselected model.
  const provider = pickPrimaryProvider(secrets, 'openwebui');
  const preferredModel = provider?.defaultModel;

  // Build multi-provider URL + key lists (semicolon-separated, index-aligned).
  // 1. Synap IS at port 4000 — always present when this runs.
  // 2. Hermes gateway at port 8642 — added when installed + has an API key.
  // 3. Custom providers (OpenAI-compatible endpoints registered by the user).
  const apiBaseUrls: string[] = ['http://eve-brain-synap:4000/v1'];
  const apiKeys: string[] = [synapApiKey];

  const hermesApiServerKey = secrets?.builder?.hermes?.apiServerKey;
  if (hermesApiServerKey && isContainerRunning('eve-builder-hermes')) {
    // Inside eve-network, Hermes is reachable by container name.
    apiBaseUrls.push('http://eve-builder-hermes:8642/v1');
    apiKeys.push(hermesApiServerKey);
  }

  // Append enabled custom providers (now in unified list).
  for (const p of providers) {
    if (p.enabled === false || !p.id.startsWith('custom-')) continue;
    if (!p.baseUrl) continue;
    // Normalise: strip trailing /v1 so we don't end up with /v1/v1
    const url = p.baseUrl.replace(/\/v1$/, '');
    apiBaseUrls.push(`${url}/v1`);
    if (p.apiKey && p.apiKey.trim()) {
      apiKeys.push(p.apiKey);
    } else {
      // No key for this custom provider — use a placeholder.
      // OpenWebUI accepts empty entries in the semicolon list.
      apiKeys.push('');
    }
  }

  const block = [
    marker,
    `SYNAP_API_KEY=${synapApiKey}`,
    // synap-backend (eve-brain-synap:4000) hosts /v1/chat/completions + /v1/models.
    // intelligence-hub (port 3001) is internal IS — it has no /v1 endpoints.
    `SYNAP_IS_URL=http://eve-brain-synap:4000`,
    // Plural form takes precedence when pipelines is also installed.
    // Hermes appears as a separate model source in the OpenWebUI model picker.
    `OPENAI_API_BASE_URLS=${apiBaseUrls.join(';')}`,
    `OPENAI_API_KEYS=${apiKeys.join(';')}`,
    ...(preferredModel ? [`DEFAULT_MODELS=${preferredModel}`] : []),
  ].join('\n');

  try {
    writeFileSync(envPath, (before ? before + '\n\n' : '') + block + '\n', { mode: 0o600 });
  } catch (err) {
    return {
      id: 'openwebui',
      outcome: 'failed',
      summary: 'could not write Open WebUI env',
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  // `docker restart` doesn't re-read .env — use compose up -d to pick up
  // the new OPENAI_API_BASE_URLS without a full teardown.
  try {
    execSync('docker compose up -d', {
      cwd: '/opt/openwebui',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err) {
    // Log the error for diagnostics (compose may not exist if OpenWebUI
    // was installed outside the lifecycle flow). Fallback to restart.
    const errMsg = err instanceof Error
      ? err.message.split('\n').pop()?.trim() ?? String(err)
      : String(err);
    if (isContainerRunning('hestia-openwebui')) {
      try { dockerRestart('hestia-openwebui'); } catch { /* ignored */ }
    }
    return {
      id: 'openwebui',
      outcome: 'failed',
      summary: `docker compose failed (${errMsg})`,
      detail: errMsg,
    };
  }
  // Fire-and-forget: register model sources + pipelines via admin API so they
  // appear in the picker. Uses centralized build + register helpers.
  // NOTE: errors are logged to stderr here. The async cascade refactor
  // (SYN-20) will convert this to a proper awaited call with structured
  // outcome propagation. Until then, `eve openwebui sync` is the recovery path.
  void (async () => {
    try {
      const { modelSources, pipelinesKey, pipelinesUrl } = buildOpenwebuiModelSources(secrets, deployDir);
      // Override Synap IS key with the correct agent key
      if (modelSources.length > 0) {
        modelSources[0].apiKey = synapApiKey;
      }
      // Override Hermes key
      const hermesIdx = modelSources.findIndex(m => m.displayName === 'Hermes Gateway');
      if (hermesIdx >= 0) {
        modelSources[hermesIdx].apiKey = hermesApiServerKey ?? '';
      }
      const ok = await registerOpenwebuiAdminApi(modelSources, {
        pipelinesUrl,
        pipelinesKey,
        managedConfig: buildOpenwebuiManagedConfig(secrets),
      });
      if (!ok) {
        process.stderr.write(
          '[eve] OpenWebUI model source registration failed (health timeout or JWT error)' +
          ' — run `eve openwebui sync` to retry\n',
        );
        return;
      }
      // Push Synap surfaces into OpenWebUI: SKILL.md → Prompts, knowledge →
      // Knowledge collection, Hub OpenAPI → external tool server. Best-effort.
      await syncOpenwebuiExtras(process.cwd(), secrets);
    } catch (err) {
      process.stderr.write(
        `[eve] OpenWebUI admin API error: ${err instanceof Error ? err.message : String(err)}` +
        ' — run `eve openwebui sync` to retry\n',
      );
    }
  })();

  const hermesNote = hermesApiServerKey ? ' + Hermes gateway' : '';
  return {
    id: 'openwebui',
    outcome: 'ok',
    summary: `Open WebUI wired to Synap IS${hermesNote}`,
    detail: envPath,
  };
}

/**
 * Hermes headless orchestrator — wires its .eve/hermes.env with AI model
 * config so it can call the Synap IS endpoint (`eve-brain-synap:4000/v1`)
 * rather than an upstream provider directly. Complements the Hub Protocol
 * wiring already written by `writeHermesEnvFile()` in builder-hub-wiring.ts.
 */
function wireHermes(secrets: EveSecrets | null): WireAiResult {
  const home = homedir();
  const eveDir = join(home, '.eve');
  const hermesEnvPath = join(home, '.eve', 'hermes.env');
  if (!existsSync(eveDir)) {
    return { id: 'hermes', outcome: 'skipped', summary: '.eve dir not found — install Hermes first' };
  }

  const synapApiKey = readAgentKeyOrLegacySync('hermes', secrets);
  if (!synapApiKey) {
    return { id: 'hermes', outcome: 'skipped', summary: 'no Hermes Hub API key — run provisioning first' };
  }

  const provider = pickPrimaryProvider(secrets, 'hermes');
  const preferredModel = provider?.defaultModel ?? 'synap/balanced';

  // synap-backend (eve-brain-synap:4000) exposes /v1/chat/completions — same
  // endpoint OpenClaw and OpenWebUI use. Hermes gets its own Hub key for auth.
  const aiBlock = [
    '# AI wiring — managed by eve ai apply',
    `AI_BASE_URL=http://eve-brain-synap:4000/v1`,
    `AI_API_KEY=${synapApiKey}`,
    `AI_DEFAULT_MODEL=${preferredModel}`,
  ].join('\n');

  let existing = '';
  try { existing = readFileSync(hermesEnvPath, 'utf-8'); } catch { /* missing */ }
  const marker = '# AI wiring — managed by eve ai apply';
  const before = existing.includes(marker) ? existing.split(marker)[0].trimEnd() : existing.trimEnd();
  const merged = (before ? before + '\n\n' : '') + aiBlock + '\n';

  try {
    writeFileSync(hermesEnvPath, merged, { mode: 0o600 });
  } catch (err) {
    return {
      id: 'hermes',
      outcome: 'failed',
      summary: 'could not write hermes.env AI block',
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  // Regenerate config.yaml (memory.provider: synap + model block) and
  // the Synap memory plugin Python files every time AI is (re)wired.
  // These are idempotent writes — safe to call on every `eve ai apply`.
  try {
    writeHermesConfigYamlSync(secrets);
    generateSynapPlugin();
  } catch { /* non-fatal — hermes.env wiring already succeeded */ }

  // Recreate Hermes container so the updated env file (including API_SERVER_KEY)
  // is picked up. Docker bakes env-file values into the container spec at creation;
  // `docker restart` reuses those stale values.
  if (isContainerRunning('eve-builder-hermes')) {
    try {
      execSync('docker rm -f eve-builder-hermes', { stdio: 'ignore' });
    } catch { /* already gone */ }
  }

  // Re-run docker run with the fresh env file + updated config.
  // Mirrors the install recipe in lifecycle/index.ts: default entrypoint
  // (`hermes gateway`) starts the API server + messaging + MCP together,
  // governed by hermes.env and config.yaml. No --entrypoint override.
  // Fire-and-forget: if docker is down, the next add/update cycle will catch up.
  try {
    const home = homedir();
    const hermesHome = join(home, '.eve', 'hermes');
    const hermesEnv = join(home, '.eve', 'hermes.env');
    const skillsDir = join(home, '.eve', 'skills');
    mkdirSync(hermesHome, { recursive: true });
    mkdirSync(skillsDir, { recursive: true });

    const args = [
      'run', '-d',
      '--name', 'eve-builder-hermes',
      '--network', 'eve-network',
      '--restart', 'unless-stopped',
      '-p', '8642:8642',
      '-p', '9119:9119',
      '-p', '9120:9120',
      '-v', `${hermesHome}:/opt/data`,
      '-v', `${skillsDir}:/opt/data/skills:ro`,
      '--env-file', hermesEnv,
      '-e', 'HERMES_HOME=/opt/data',
      'nousresearch/hermes-agent:latest',
    ];
    execSync(`docker ${args.join(' ')}`, { stdio: 'pipe', timeout: 30_000 });
  } catch { /* non-fatal — next add/update will pick up */ }

  return {
    id: 'hermes',
    outcome: 'ok',
    summary: `Hermes wired → ${preferredModel} (config + plugin regenerated)`,
    detail: hermesEnvPath,
  };
}

/**
 * Builder organ components (OpenCode / OpenClaude) consume AI via the Synap
 * pod (Hub Protocol Bearer SYNAP_API_KEY). Their wiring is handled by
 * `builder-hub-wiring.ts` — this function defers to that.
 */
function wireBuilder(_secrets: EveSecrets | null, componentId: string): WireAiResult {
  return {
    id: componentId,
    outcome: 'skipped',
    summary: 'builder organ uses Synap IS via Hub Protocol — wired during install',
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Public API
// ───────────────────────────────────────────────────────────────────────────

/**
 * Components whose AI wiring is centrally managed via `secrets.ai`.
 *
 * Single source of truth for which components participate in:
 *   - auto-seed on install (`@eve/lifecycle/installOne`)
 *   - auto-apply on UI change (`POST /api/ai/providers`, `PATCH /api/ai`)
 *   - per-service routing (`secrets.ai.serviceProviders[componentId]`)
 *
 * Adding a new AI consumer means: extend this set, add a `wire*` function
 * below, route it from `wireComponentAi`, and (if it has env-affecting
 * secrets) ensure the apply path triggers `recreate` for it via lifecycle.
 */
export const AI_CONSUMERS: ReadonlySet<string> = new Set([
  'synap',
  'openclaw',
  'openwebui',
  'hermes',
]);

/**
 * Components whose effective AI config is set at `docker run` time (env
 * vars, not file-mounted). For these, a `wire*` write + `dockerRestart`
 * is NOT enough — the apply path must call lifecycle's `recreate` so the
 * new env actually lands in the container.
 *
 * `synap` mounts its env via compose, so `compose up -d` (handled by the
 * synap install path) is sufficient; restart-only is fine post-wire.
 * `openclaw` runs as a plain `docker run -e`, hence the recreate.
 * `openwebui` is compose-based — its .env is read on first boot, and
 * the DB is authoritative thereafter. For env var changes after first
 * boot, `wireOpenwebui` also calls the admin API upsert path. A full
 * recreate is only needed when the container spec itself changes (e.g.
 * new env keys added to compose.yaml).
 * `hermes` runs via `docker run --env-file`, hence the recreate.
 */
export const AI_CONSUMERS_NEEDING_RECREATE: ReadonlySet<string> = new Set([
  'openclaw',
  // Hermes is started via `docker run --env-file ~/.eve/hermes.env`. Docker
  // bakes env vars into the container spec at creation time — `docker restart`
  // reuses those stale values. Any channel credential or AI config change
  // requires a full recreate so the updated hermes.env is re-read.
  'hermes',
  // OpenWebUI reads OPENAI_API_BASE_URLS from .env on first boot. `docker
  // restart` won't re-read the file — compose up -d is required. The admin
  // API can update config without restart, but the primary path uses recreate.
  'openwebui',
]);

/**
 * Wire AI for one component. Caller catches errors; this function returns
 * a typed result instead of throwing.
 */
export function wireComponentAi(componentId: string, secrets: EveSecrets | null): WireAiResult {
  const comp = COMPONENTS.find(c => c.id === componentId);
  if (!comp) {
    return { id: componentId, outcome: 'failed', summary: `unknown component: ${componentId}` };
  }

  switch (componentId) {
    case 'synap':     return wireSynapIs(secrets);
    case 'openclaw':  return wireOpenclaw(secrets);
    case 'openwebui': return wireOpenwebui(secrets);
    case 'hermes':    return wireHermes(secrets);
    case 'opencode':
    case 'openclaude':
      return wireBuilder(secrets, componentId);
    default:
      // Components that don't consume AI (traefik, ollama, rsshub, dokploy)
      return {
        id: componentId,
        outcome: 'skipped',
        summary: 'no AI wiring needed',
      };
  }
}

/**
 * Wire AI for every installed component. Useful from `eve install`,
 * `eve ai apply`, and `eve ai providers add`.
 */
export function wireAllInstalledComponents(
  secrets: EveSecrets | null,
  installedComponents: string[],
): WireAiResult[] {
  return installedComponents.map(id => wireComponentAi(id, secrets));
}

/**
 * Build model sources for OpenWebUI's manifold API + extract pipelines key
 * from the deploy directory. Used by `registerPipelinesInOpenwebui` and
 * `wireHermesIntoOpenwebui` in @eve/lifecycle.
 */
export function buildOpenwebuiModelSources(
  secrets: EveSecrets | null,
  deployDir: string,
): { modelSources: ModelSource[]; pipelinesKey: string; pipelinesUrl: string | null } {
  // Extract the pipelines key. The pipelines install/update path passes its
  // own deploy dir, while OpenWebUI/Hermes wiring runs from /opt/openwebui.
  // Fall back to the canonical pipelines env so every caller can register the
  // sidecar when it exists.
  let pipelinesKey = '';
  for (const envDir of [deployDir, '/opt/openwebui-pipelines']) {
    const pipelinesEnvPath = join(envDir, '.env');
    if (!existsSync(pipelinesEnvPath)) continue;
    const pipelinesEnv = readFileSync(pipelinesEnvPath, 'utf-8');
    pipelinesKey = pipelinesEnv.split('\n')
      .find(l => l.startsWith('PIPELINES_API_KEY='))?.split('=', 2)[1]?.trim() ?? '';
    if (pipelinesKey) break;
  }
  const pipelinesUrl = pipelinesKey ? 'http://eve-openwebui-pipelines:9099' : null;

  const providers = secrets?.ai?.providers ?? [];
  const modelSources: ModelSource[] = [];

  // Synap IS
  modelSources.push({
    url: 'http://eve-brain-synap:4000/v1',
    apiKey: '',
    displayName: 'Synap IS',
  });

  // Hermes Gateway
  // If Hermes is down at reconcile time, it's omitted from OWUI sources — operators must re-apply once Hermes is up.
  const hermesApiKey = secrets?.builder?.hermes?.apiServerKey ?? '';
  if (hermesApiKey && isContainerRunning('eve-builder-hermes')) {
    modelSources.push({
      url: 'http://eve-builder-hermes:8642/v1',
      apiKey: hermesApiKey,
      displayName: 'Hermes Gateway',
    });
  }

  // Enabled custom providers — with baseUrl (live) or without (cached models)
  for (const p of providers) {
    if (p.enabled === false || !p.id.startsWith('custom-')) continue;
    const hasLiveUrl = !!(p.baseUrl && p.apiKey);
    if (!hasLiveUrl) continue;
    modelSources.push({
      url: p.baseUrl!.replace(/\/v1$/, '') + '/v1',
      apiKey: p.apiKey ?? '',
      displayName: p.name ?? p.id,
      models: p.models,
    });
  }

  return { modelSources, pipelinesKey, pipelinesUrl };
}

export function buildOpenwebuiManagedConfig(
  secrets: EveSecrets | null,
): Omit<OpenWebuiManagedConfig, 'modelSources'> {
  const provider = pickPrimaryProvider(secrets, 'openwebui');
  const defaultModels = secrets?.ai?.serviceModels?.openwebui ?? provider?.defaultModel ?? 'synap/auto';
  const domain = secrets?.domain?.primary?.trim();
  const webuiUrl = domain && domain !== 'localhost'
    ? `${secrets?.domain?.ssl ? 'https' : 'http'}://chat.${domain}`
    : '';

  return {
    defaultModels,
    webuiUrl,
    webuiName: 'Eve',
    enableSignup: true,
    defaultUserRole: 'pending',
  };
}

/**
 * Ordered registration flow for OpenWebUI's admin API:
 *   1. Wait for pipelines sidecar (brief, fire-and-forget)
 *   2. Wait for OpenWebUI health (JWT + admin user ready)
 *   3. Register pipeline sidecar (if key present)
 *   4. Upsert model sources (best-effort, single retry)
 *
 * Returns true if all steps succeeded (or were skipped).
 *
 * The old inline version used a "wait 90s then force-retry 3 times" pattern.
 * This version runs the sidecar probe and OpenWebUI health wait in parallel,
 * then registers once if healthy:
 *   - Sidecar probe only runs if pipelines key exists (fire-and-forget)
 *   - OpenWebUI health is the blocking step (30×3s = 90s)
 *   - Both start simultaneously — saves ~15s in happy path
 *   - Registration runs exactly once per healthy OpenWebUI
 *   - If OpenWebUI never becomes healthy, we skip registration cleanly
 */
export async function registerOpenwebuiAdminApi(
  modelSources: ModelSource[],
  options: {
    pipelinesUrl?: string | null;
    pipelinesKey?: string;
    managedConfig?: Omit<OpenWebuiManagedConfig, 'modelSources'>;
    /** Override the health-check attempt count (default: 12 × 5 s = 60 s). */
    maxRetries?: number;
    /** Override the sidecar probe attempt count (default: 5 × 3 s = 15 s). */
    retryInterval?: number;
  },
): Promise<boolean> {
  const healthAttempts = options.maxRetries ?? 12;
  const sidecarAttempts = options.retryInterval ?? 5;

  // Step 1: Start sidecar probe and OpenWebUI health wait in parallel
  const sidecarPromise = (async () => {
    if (!options.pipelinesUrl || !options.pipelinesKey) return false;
    for (let i = 0; i < sidecarAttempts; i++) {
      try {
        const r = await fetch(`${options.pipelinesUrl}/health`, { signal: AbortSignal.timeout(3000) });
        if (r.ok || r.status >= 400) return true;
      } catch { /* not ready yet */ }
      await new Promise(r => setTimeout(r, 3_000));
    }
    return false;
  })();

  // Step 2: Wait for health once using waitForHealth() (attempts × 5 s poll).
  // This avoids the old bug where getStatus() internally called waitUntilHealthy()
  // on every retry attempt, causing the retry loop to exhaust before health passed.
  if (!(await waitForHealth(undefined, healthAttempts))) {
    return false;
  }

  // Use the post-health fast path — health is already confirmed above.
  // getAdminJwt() would re-run waitUntilHealthy() (another 30 s budget),
  // which wastes time and can race-fail even though health just passed.
  const jwt = await getAdminJwtPostHealth();
  if (!jwt) return false;

  // Step 3: OpenWebUI is healthy and admin auth works — resolve sidecar probe result
  const sidecarReady = await sidecarPromise;

  // Step 4: Register pipeline sidecar (if sidecar is ready)
  if (sidecarReady && options.pipelinesUrl && options.pipelinesKey) {
    await registerPipeline(jwt, options.pipelinesUrl, options.pipelinesKey);
  }

  // Step 5: Reconcile Eve-managed persisted config. This is the headless
  // equivalent of using OpenWebUI's Admin Settings UI after first boot.
  await reconcileOpenwebuiManagedConfigViaAdmin(jwt, {
    ...(options.managedConfig ?? {}),
    modelSources,
  });

  return true;
}

/**
 * Inverse check: is the user's `secrets.ai` ready to wire components, or do
 * they need to add a provider first?
 */
export function hasAnyProvider(secrets: EveSecrets | null): boolean {
  const providers = secrets?.ai?.providers ?? [];
  return providers.some(p => p.apiKey && p.apiKey.trim().length > 0);
}
