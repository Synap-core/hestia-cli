import { COMPONENTS, resolveSynapUrl } from './components.js';
import { discoverPodConfig } from './discover.js';
import { entityStateManager } from './entity-state.js';
import { readOperationalEvents } from './operational.js';
import { readEveSecrets, secretsPath, type EveSecrets } from './secrets-contract.js';
import { getEveEventsPath, getEveStateHome, getEveStatePath } from './state-paths.js';

const SECRET_KEY_PATTERN = /(api[_-]?key|token|secret|password|private|jwk|bearer|authorization|cookie|session)/i;

export function redactSecrets<T>(value: T): T {
  return redactValue(value) as T;
}

function redactValue(value: unknown, key?: string): unknown {
  if (key && SECRET_KEY_PATTERN.test(key)) {
    if (typeof value === 'string' && value.length <= 6) return value ? '***redacted***' : value;
    if (typeof value === 'string') return `${value.slice(0, 3)}***${value.slice(-3)}`;
    return value == null ? value : '***redacted***';
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [
        entryKey,
        redactValue(entryValue, entryKey),
      ]),
    );
  }

  return value;
}

function summarizeState(state: Awaited<ReturnType<typeof entityStateManager.getState>>) {
  return {
    version: state.version,
    initializedAt: state.initializedAt,
    aiModel: state.aiModel,
    installed: state.installed ?? {},
    setupProfile: state.setupProfile,
    metadata: state.metadata,
  };
}

function canonicalUrls(secrets: EveSecrets | null) {
  return {
    apiUrl: secrets?.synap?.apiUrl
      ? { value: secrets.synap.apiUrl, source: 'secrets', confidence: 'canonical' }
      : { value: null, source: 'default', confidence: 'fallback' },
    podUrl: secrets?.pod?.url
      ? { value: secrets.pod.url, source: 'secrets', confidence: 'canonical' }
      : { value: null, source: 'default', confidence: 'fallback' },
    podDomain: secrets?.domain?.primary
      ? { value: secrets.domain.primary, source: 'secrets', confidence: 'canonical' }
      : { value: null, source: 'default', confidence: 'fallback' },
    resolvedSynapUrl: secrets
      ? { value: resolveSynapUrl(secrets), source: 'derived', confidence: 'canonical' }
      : { value: null, source: 'default', confidence: 'fallback' },
  };
}

export async function buildConfigDebugPayload() {
  const [secrets, state] = await Promise.all([
    readEveSecrets().catch(() => null),
    entityStateManager.getState().catch(() => null),
  ]);

  return redactSecrets({
    paths: {
      eveHome: process.env.EVE_HOME ?? null,
      stateHome: getEveStateHome(),
      secretsPath: secretsPath(),
      statePath: getEveStatePath(),
      eventsPath: getEveEventsPath(),
    },
    canonical: {
      secrets,
      urls: canonicalUrls(secrets),
    },
    state: state ? summarizeState(state) : null,
  });
}

export async function buildDiscoveryDebugPayload() {
  const [secrets, discovered] = await Promise.all([
    readEveSecrets().catch(() => null),
    Promise.resolve().then(() => discoverPodConfig()).catch(() => null),
  ]);

  return redactSecrets({
    canonical: canonicalUrls(secrets),
    discovered: discovered
      ? {
          synapUrl: {
            value: discovered.synapUrl,
            source: 'discovery',
            confidence: secrets?.pod?.url && discovered.synapUrl && secrets.pod.url !== discovered.synapUrl ? 'conflict' : 'fallback',
          },
          domain: {
            value: discovered.domain,
            source: 'discovery',
            confidence: secrets?.domain?.primary && discovered.domain && secrets.domain.primary !== discovered.domain ? 'conflict' : 'fallback',
          },
          sources: discovered.sources,
        }
      : null,
  });
}

export async function buildMaterializedDebugPayload() {
  const secrets = await readEveSecrets().catch(() => null);
  const targets = new Set(COMPONENTS.flatMap((component) => component.materializers ?? []));

  return redactSecrets({
    targets: Array.from(targets).sort(),
    backendEnv: {
      DOMAIN: secrets?.domain?.primary ?? null,
      PUBLIC_URL: secrets?.synap?.apiUrl ?? null,
    },
    traefikRoutes: {
      domain: secrets?.domain?.primary ?? null,
      apiUrl: secrets?.synap?.apiUrl ?? null,
    },
    aiWiring: {
      provider: secrets?.ai?.defaultProvider ?? null,
      consumers: COMPONENTS
        .filter((component) => component.materializers?.includes('ai-wiring'))
        .map((component) => component.id),
    },
  });
}

export async function buildEventsDebugPayload(limit = 100) {
  return {
    events: await readOperationalEvents({ limit }),
  };
}
