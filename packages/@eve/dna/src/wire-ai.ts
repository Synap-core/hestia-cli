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
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { EveSecrets } from './secrets-contract.js';
import { COMPONENTS } from './components.js';

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

/** Pick the user's primary AI provider entry. Prefers `defaultProvider`, then first enabled. */
function pickPrimaryProvider(secrets: EveSecrets | null) {
  const providers = (secrets?.ai?.providers ?? []).filter(p => p.apiKey && p.apiKey.trim().length > 0);
  if (providers.length === 0) return null;
  const def = secrets?.ai?.defaultProvider;
  return providers.find(p => p.id === def) ?? providers.find(p => p.enabled !== false) ?? providers[0];
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

  // Build env additions for each provider that has a key
  const envLines: string[] = ['# AI provider keys — managed by eve ai apply'];
  for (const p of providers) {
    if (!p.apiKey) continue;
    if (p.id === 'openai') envLines.push(`OPENAI_API_KEY=${p.apiKey}`);
    if (p.id === 'anthropic') envLines.push(`ANTHROPIC_API_KEY=${p.apiKey}`);
    if (p.id === 'openrouter') envLines.push(`OPENROUTER_API_KEY=${p.apiKey}`);
  }
  if (secrets?.ai?.defaultProvider) {
    envLines.push(`DEFAULT_AI_PROVIDER=${secrets.ai.defaultProvider}`);
  }

  // Append to existing .env, replacing any prior eve-managed block
  const envPath = join(deployDir, '.env');
  let existing = '';
  try {
    existing = require('node:fs').readFileSync(envPath, 'utf-8') as string;
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
  const synapApiKey = secrets?.synap?.apiKey?.trim();
  if (!synapApiKey) {
    return { id: 'openclaw', outcome: 'skipped', summary: 'no Synap pod API key — install Synap first' };
  }
  if (!isContainerRunning('eve-arms-openclaw')) {
    return { id: 'openclaw', outcome: 'skipped', summary: 'eve-arms-openclaw container not running' };
  }

  // OpenClaw's auth store format. Default agent is "main".
  const authProfile = {
    providers: {
      openai: {
        apiKey: synapApiKey,
        baseUrl: 'http://intelligence-hub:3001/v1',
      },
    },
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
 */
function wireOpenwebui(secrets: EveSecrets | null): WireAiResult {
  const synapApiKey = secrets?.synap?.apiKey?.trim();
  if (!synapApiKey) {
    return { id: 'openwebui', outcome: 'skipped', summary: 'no Synap pod API key — install Synap first' };
  }

  const deployDir = '/opt/openwebui';
  const envPath = join(deployDir, '.env');
  if (!existsSync(deployDir)) {
    return { id: 'openwebui', outcome: 'skipped', summary: 'Open WebUI deploy dir not found — install it first' };
  }

  // Read existing, replace eve-managed block
  let existing = '';
  try {
    existing = require('node:fs').readFileSync(envPath, 'utf-8') as string;
  } catch { /* missing */ }

  const marker = '# AI wiring — managed by eve ai apply';
  const before = existing.includes(marker) ? existing.split(marker)[0].trimEnd() : existing.trimEnd();

  const block = [
    marker,
    `SYNAP_API_KEY=${synapApiKey}`,
    `SYNAP_IS_URL=http://intelligence-hub:3001`,
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

  // Restart so the new env is picked up
  if (isContainerRunning('hestia-openwebui')) {
    dockerRestart('hestia-openwebui');
  }

  return {
    id: 'openwebui',
    outcome: 'ok',
    summary: 'Open WebUI wired to Synap IS',
    detail: envPath,
  };
}

/**
 * Builder organ components (Hermes / OpenCode / OpenClaude) consume AI via
 * the Synap pod (Hub Protocol Bearer SYNAP_API_KEY). They don't talk to
 * upstream providers directly. Their wiring is handled by
 * `builder-hub-wiring.ts` already — this function defers to that.
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
    case 'hermes':
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
  // Prevent unused-import warnings while still surfacing pickPrimaryProvider for future helpers.
  void pickPrimaryProvider;
  return installedComponents.map(id => wireComponentAi(id, secrets));
}

/**
 * Inverse check: is the user's `secrets.ai` ready to wire components, or do
 * they need to add a provider first?
 */
export function hasAnyProvider(secrets: EveSecrets | null): boolean {
  const providers = secrets?.ai?.providers ?? [];
  return providers.some(p => p.apiKey && p.apiKey.trim().length > 0);
}
