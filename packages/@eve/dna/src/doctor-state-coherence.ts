/**
 * Doctor checks for "Eve's centralized state is coherent": every enabled
 * provider has usable config, every routed channel has required credentials,
 * every AI consumer's wiring is fresh, and Synap surfaces actually exist
 * inside OpenWebUI (Prompts, Knowledge collection, tool server).
 *
 * Local checks always run. Remote probes (Synap Hub, OpenWebUI admin API)
 * skip cleanly if the target isn't reachable rather than failing the run.
 */

import { resolveHubBaseUrl } from './builder-hub-wiring.js';
import { getAdminJwt } from './openwebui-admin.js';
import type { DoctorCheck, DoctorStatus } from './operational.js';
import { readAgentKeyOrLegacySync, type EveSecrets, type UnifiedProvider } from './secrets-contract.js';

const BUILT_IN_PROVIDERS = new Set(['ollama', 'openai', 'anthropic', 'openrouter']);
const REQUIRED_CHANNEL_FIELDS: Record<string, ReadonlyArray<string>> = {
  telegram: ['botToken'],
  discord: ['botToken'],
  whatsapp: ['phoneNumberId', 'accessToken'],
  signal: ['phoneNumber'],
  matrix: ['homeserverUrl', 'accessToken'],
  slack: ['botToken', 'signingSecret'],
};
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

const SKILL_COMMANDS = ['synap', 'synap-schema', 'synap-ui'];
const KNOWLEDGE_COLLECTION_PREFIX = 'Synap Knowledge';
const SYNAP_TOOL_SERVER_NAME = 'Synap Hub Protocol';

export interface StateCoherenceOptions {
  /** When false, skip remote probes (Synap pod, OpenWebUI admin API). Default true. */
  probeRemote?: boolean;
  /** Per-probe network timeout. Default 5000ms. */
  timeoutMs?: number;
  /** Inject for tests. */
  fetch?: typeof fetch;
  /** Inject for tests. Returning null means OWUI is not reachable. */
  getAdminJwt?: () => Promise<string | null>;
  /** Inject for tests. Returns the eve agent's Hub bearer or null. */
  readEveHubKey?: (secrets: EveSecrets) => string | null;
  /** Override for "now" in freshness checks. */
  now?: () => Date;
}

export async function runStateCoherenceChecks(
  secrets: EveSecrets | null,
  opts: StateCoherenceOptions = {},
): Promise<DoctorCheck[]> {
  if (!secrets) {
    return [{
      group: 'config',
      name: 'Eve secrets',
      status: 'fail',
      message: 'secrets.json could not be read',
      fix: 'Run `eve setup` to initialize Eve',
    }];
  }

  const checks: DoctorCheck[] = [
    ...checkProviders(secrets),
    ...checkServiceRouting(secrets),
    ...checkChannels(secrets),
    ...checkWiringStatus(secrets, opts.now ?? (() => new Date())),
  ];

  if (opts.probeRemote !== false) {
    checks.push(...await probeSynapHub(secrets, opts));
    checks.push(...await probeOpenwebuiExtras(secrets, opts));
  }

  return checks;
}

// ─── Local checks ────────────────────────────────────────────────────────────

function checkProviders(secrets: EveSecrets): DoctorCheck[] {
  const providers = secrets.ai?.providers ?? [];
  if (providers.length === 0) {
    return [{
      group: 'ai',
      name: 'AI providers',
      status: 'warn',
      message: 'No providers configured in secrets.ai.providers',
      fix: 'Add a provider in the dashboard (Settings → AI) or run `eve ai set-provider`',
    }];
  }
  const enabled = providers.filter(p => p.enabled !== false);
  if (enabled.length === 0) {
    return [{
      group: 'ai',
      name: 'AI providers',
      status: 'warn',
      message: `${providers.length} provider(s) configured, none enabled`,
      fix: 'Toggle a provider on in the dashboard AI settings',
    }];
  }

  const checks: DoctorCheck[] = [];
  for (const p of enabled) {
    const status = providerCoherenceStatus(p);
    checks.push({
      group: 'ai',
      name: `Provider: ${p.name ?? p.id}`,
      status: status.status,
      message: status.message,
      fix: status.fix,
    });
  }
  return checks;
}

function providerCoherenceStatus(p: UnifiedProvider): { status: DoctorStatus; message: string; fix?: string } {
  const isBuiltIn = BUILT_IN_PROVIDERS.has(p.id);
  const hasUsableConfig = !!(p.baseUrl && p.apiKey);

  if (isBuiltIn) {
    if (p.id === 'ollama') {
      return { status: 'pass', message: 'Built-in Ollama (local)' };
    }
    if (!p.apiKey) {
      return {
        status: 'fail',
        message: `${p.id} enabled but no apiKey set`,
        fix: `Set the API key in dashboard Settings → AI → ${p.id}`,
      };
    }
    return { status: 'pass', message: `Built-in ${p.id}, apiKey set` };
  }
  if (!hasUsableConfig) {
    return {
      status: 'fail',
      message: `Custom provider missing baseUrl or apiKey`,
      fix: 'Edit the provider in dashboard Settings → AI or remove it',
    };
  }
  return { status: 'pass', message: `Custom provider, baseUrl + apiKey set` };
}

function checkServiceRouting(secrets: EveSecrets): DoctorCheck[] {
  const overrides = secrets.ai?.serviceProviders ?? {};
  const providers = secrets.ai?.providers ?? [];
  const byId = new Map(providers.map(p => [p.id, p]));

  const checks: DoctorCheck[] = [];
  for (const [componentId, providerId] of Object.entries(overrides)) {
    if (!providerId) continue;
    const p = byId.get(providerId);
    if (!p) {
      checks.push({
        group: 'wiring',
        name: `Routing: ${componentId} → ${providerId}`,
        status: 'fail',
        message: `Component routed to provider '${providerId}' which is not in providers list`,
        fix: `Update routing in dashboard Settings → AI or add the provider`,
        componentId,
      });
      continue;
    }
    if (p.enabled === false) {
      checks.push({
        group: 'wiring',
        name: `Routing: ${componentId} → ${providerId}`,
        status: 'warn',
        message: `Component routed to '${providerId}' but the provider is disabled`,
        fix: `Enable provider '${providerId}' or change the routing`,
        componentId,
      });
      continue;
    }
    checks.push({
      group: 'wiring',
      name: `Routing: ${componentId} → ${providerId}`,
      status: 'pass',
      message: `Routed to enabled provider`,
      componentId,
    });
  }
  return checks;
}

function checkChannels(secrets: EveSecrets): DoctorCheck[] {
  const channels = secrets.channels ?? {};
  const checks: DoctorCheck[] = [];
  for (const [platform, required] of Object.entries(REQUIRED_CHANNEL_FIELDS)) {
    const entry = (channels as Record<string, Record<string, unknown> | undefined>)[platform];
    if (!entry || entry.enabled !== true) continue;
    const missing = required.filter(field => !entry[field] || (typeof entry[field] === 'string' && (entry[field] as string).trim() === ''));
    if (missing.length > 0) {
      checks.push({
        group: 'integrations',
        name: `Channel: ${platform}`,
        status: 'fail',
        message: `Enabled but missing: ${missing.join(', ')}`,
        fix: `Run \`eve arms messaging configure ${platform}\` with the required flags`,
      });
    } else {
      checks.push({
        group: 'integrations',
        name: `Channel: ${platform}`,
        status: 'pass',
        message: 'Enabled with all required credentials',
      });
    }
  }
  return checks;
}

function checkWiringStatus(secrets: EveSecrets, now: () => Date): DoctorCheck[] {
  const wiring = secrets.ai?.wiringStatus ?? {};
  const checks: DoctorCheck[] = [];
  for (const [componentId, entry] of Object.entries(wiring)) {
    const outcome = (entry?.outcome ?? '').toLowerCase();
    const isOk = outcome.startsWith('ok') || outcome.startsWith('open webui') || outcome.includes('wired');
    const lastApplied = entry?.lastApplied ? Date.parse(entry.lastApplied) : NaN;
    const ageMs = Number.isFinite(lastApplied) ? now().getTime() - lastApplied : NaN;
    if (!isOk) {
      checks.push({
        group: 'wiring',
        name: `Last apply: ${componentId}`,
        status: 'fail',
        message: `outcome=${entry?.outcome ?? '(unknown)'}`,
        fix: 'Re-run `eve ai apply` or restart the component',
        componentId,
      });
      continue;
    }
    if (Number.isFinite(ageMs) && ageMs > SEVEN_DAYS_MS) {
      const days = Math.floor(ageMs / (24 * 60 * 60 * 1000));
      checks.push({
        group: 'wiring',
        name: `Last apply: ${componentId}`,
        status: 'warn',
        message: `Applied ${days}d ago — config may have drifted`,
        fix: 'Run `eve ai apply` to refresh',
        componentId,
      });
    } else {
      checks.push({
        group: 'wiring',
        name: `Last apply: ${componentId}`,
        status: 'pass',
        message: `outcome=${entry?.outcome ?? 'ok'}`,
        componentId,
      });
    }
  }
  return checks;
}

// ─── Remote probes ───────────────────────────────────────────────────────────

async function probeSynapHub(secrets: EveSecrets, opts: StateCoherenceOptions): Promise<DoctorCheck[]> {
  const hubBaseUrl = resolveHubBaseUrl(secrets);
  if (!hubBaseUrl) {
    return [{
      group: 'integrations',
      name: 'Synap Hub Protocol',
      status: 'skip',
      message: 'No hubBaseUrl in secrets',
    }];
  }
  const readKey = opts.readEveHubKey ?? ((s) => readAgentKeyOrLegacySync('eve', s));
  const apiKey = readKey(secrets);
  if (!apiKey) {
    return [{
      group: 'integrations',
      name: 'Synap Hub Protocol',
      status: 'fail',
      message: 'No eve agent key in secrets.agents.eve.hubApiKey',
      fix: 'Run `eve auth provision --agent eve`',
    }];
  }

  const f = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 5000;
  try {
    const res = await f(`${hubBaseUrl.replace(/\/$/, '')}/skills/system`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status === 401 || res.status === 403) {
      return [{
        group: 'integrations',
        name: 'Synap Hub Protocol',
        status: 'fail',
        message: `Pod rejected the eve agent key (${res.status})`,
        fix: 'Run `eve auth renew --agent eve` or re-provision',
      }];
    }
    if (!res.ok) {
      return [{
        group: 'integrations',
        name: 'Synap Hub Protocol',
        status: 'warn',
        message: `Hub probe returned ${res.status}`,
      }];
    }
    return [{
      group: 'integrations',
      name: 'Synap Hub Protocol',
      status: 'pass',
      message: `Reachable, eve agent authenticated`,
    }];
  } catch (err) {
    return [{
      group: 'integrations',
      name: 'Synap Hub Protocol',
      status: 'skip',
      message: `Pod not reachable from this host (${errorMessage(err)})`,
    }];
  }
}

async function probeOpenwebuiExtras(secrets: EveSecrets, opts: StateCoherenceOptions): Promise<DoctorCheck[]> {
  const jwtFn = opts.getAdminJwt ?? (() => getAdminJwt().catch(() => null));
  const jwt = await jwtFn();
  if (!jwt) {
    return [{
      group: 'integrations',
      name: 'OpenWebUI extras',
      status: 'skip',
      message: 'OpenWebUI admin JWT not available (container down or admin row missing)',
    }];
  }

  const f = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 5000;
  const headers = { Authorization: `Bearer ${jwt}` };
  const baseUrl = 'http://localhost:3000';

  const checks: DoctorCheck[] = [];

  // Skills as Prompts
  try {
    const res = await f(`${baseUrl}/api/v1/prompts/`, { headers, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`prompts list ${res.status}`);
    const prompts = (await res.json()) as Array<{ command?: string }>;
    const present = new Set(prompts.map(p => p.command).filter((x): x is string => !!x));
    const missing = SKILL_COMMANDS.filter(s => !present.has(s));
    checks.push({
      group: 'integrations',
      name: 'OpenWebUI: Synap skills as Prompts',
      status: missing.length === 0 ? 'pass' : 'warn',
      message: missing.length === 0
        ? `All 3 SKILL.md packages present (${SKILL_COMMANDS.join(', ')})`
        : `Missing: ${missing.join(', ')}`,
      fix: missing.length === 0 ? undefined : 'Run `eve ai apply` to re-trigger the extras sync',
    });
  } catch (err) {
    checks.push({
      group: 'integrations',
      name: 'OpenWebUI: Synap skills as Prompts',
      status: 'skip',
      message: `Could not list prompts (${errorMessage(err)})`,
    });
  }

  // Knowledge collection
  try {
    const res = await f(`${baseUrl}/api/v1/knowledge/`, { headers, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`knowledge list ${res.status}`);
    const list = (await res.json()) as Array<{ name?: string }>;
    const found = list.some(c => typeof c.name === 'string' && c.name.startsWith(KNOWLEDGE_COLLECTION_PREFIX));
    checks.push({
      group: 'integrations',
      name: 'OpenWebUI: Synap knowledge collection',
      status: found ? 'pass' : 'warn',
      message: found ? `"${KNOWLEDGE_COLLECTION_PREFIX}…" collection present` : `No collection starting with "${KNOWLEDGE_COLLECTION_PREFIX}" found`,
      fix: found ? undefined : 'Run `eve ai apply` to re-trigger the extras sync',
    });
  } catch (err) {
    checks.push({
      group: 'integrations',
      name: 'OpenWebUI: Synap knowledge collection',
      status: 'skip',
      message: `Could not list knowledge (${errorMessage(err)})`,
    });
  }

  // Tool server registration
  try {
    const res = await f(`${baseUrl}/api/v1/configs/`, { headers, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`configs ${res.status}`);
    const config = (await res.json()) as Record<string, unknown>;
    const ts = (config['tool_server'] ?? config['tool_servers']) as { connections?: Array<{ name?: string; url?: string }> } | undefined;
    const connections = ts?.connections ?? [];
    const found = connections.some(c => c.name === SYNAP_TOOL_SERVER_NAME || (typeof c.url === 'string' && c.url.includes('/api/hub/openapi.json')));
    checks.push({
      group: 'integrations',
      name: 'OpenWebUI: Synap tool server',
      status: found ? 'pass' : 'warn',
      message: found ? `"${SYNAP_TOOL_SERVER_NAME}" registered` : 'Synap Hub Protocol not in tool_server.connections',
      fix: found ? undefined : 'Run `eve ai apply` to re-trigger the extras sync',
    });
  } catch (err) {
    checks.push({
      group: 'integrations',
      name: 'OpenWebUI: Synap tool server',
      status: 'skip',
      message: `Could not read OpenWebUI config (${errorMessage(err)})`,
    });
  }

  return checks;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.name === 'TimeoutError' ? 'timeout' : err.message;
  return String(err);
}
