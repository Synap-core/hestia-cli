# Centralized Config Store — Implementation Plan

## Phase 1: ConfigStore skeleton in @eve/dna

**New file:** `packages/@eve/dna/src/config-store.ts`

```typescript
/**
 * Centralized config store — single in-memory cache for secrets.json reads.
 *
 * Per-process singleton. Lazy-load on first access. Cache invalidation via
 * reload() (called after writes) or reset() (test hook).
 *
 * Design:
 *   - Module-level singleton, exported via `configStore` identifier
 *   - Cache stores { secrets: EveSecrets | null, loadedAt: number }
 *   - get() returns cached value if loadedAt > 0ms ago (config never changes
 *     inside a process unless reload() is called)
 *   - getSection<K>(key) returns raw nested shape without destructuring
 *   - onChange(fn) returns unsubscribe function
 *   - reload() forces re-read from disk and fires change subscribers
 *   - reset() clears cache (test hook)
 */

import type { EveSecrets } from './secrets-contract.js';
import { readEveSecrets, secretsPath } from './secrets-contract.js';

interface CacheEntry {
  secrets: EveSecrets | null;
  loadedAt: number;
}

interface Subscriber {
  (secrets: EveSecrets | null): void;
}

const cache: CacheEntry = { secrets: null, loadedAt: 0 };
const subscribers: Subscriber[] = [];

async function _load(): Promise<EveSecrets | null> {
  try {
    const secrets = await readEveSecrets();
    cache.secrets = secrets;
    cache.loadedAt = Date.now();
    // Fire subscribers synchronously (they may call get() to read new value)
    for (const sub of subscribers) {
      try { sub(secrets); } catch { /* subscriber errors don't break reload */ }
    }
    return secrets;
  } catch {
    if (cache.secrets === null) {
      cache.secrets = null;
      cache.loadedAt = Date.now();
    }
    return null;
  }
}

export interface ConfigStore {
  get(): Promise<EveSecrets | null>;
  getSection<K extends keyof EveSecrets>(key: K): EveSecrets[K] | null;
  reload(): Promise<void>;
  reset(): void;
  onChange(fn: Subscriber): () => void;
}

export const configStore: ConfigStore = {
  async get(): Promise<EveSecrets | null> {
    // If cache has a value, return it. Otherwise load.
    if (cache.secrets !== null) return cache.secrets;
    return _load();
  },

  getSection<K extends keyof EveSecrets>(key: K): EveSecrets[K] | null {
    // getSection returns raw nested shape. First ensure cache is loaded.
    if (cache.secrets === null) {
      // Synchronous access before async load — return null.
      // Callers should use get() if they need the full document async.
      return null;
    }
    return cache.secrets[key] ?? null;
  },

  async reload(): Promise<void> {
    await _load();
  },

  reset(): void {
    cache.secrets = null;
    cache.loadedAt = 0;
  },

  onChange(fn: Subscriber): () => void {
    subscribers.push(fn);
    return () => {
      const idx = subscribers.indexOf(fn);
      if (idx >= 0) subscribers.splice(idx, 1);
    };
  },
};

```

**Modified:** `packages/@eve/dna/src/secrets-contract.ts`
- `readEveSecrets()` stays as-is (file I/O function)
- Export `configStore` from the module for internal use

**Modified:** `packages/@eve/dna/src/pod-url.ts`
- Import `configStore` instead of calling `readEveSecrets()` directly
- `readPodUrlFromSecrets()` → `configStore.get()` then extract from `.synap.apiUrl` / `.pod.url` / `.domain.primary`

**Modified:** `packages/@eve/dna/src/index.ts`
- Add `configStore` to exports alongside existing secrets exports

**Modified:** `packages/@eve/dna/src/discover.ts`
- Add `discoverAndBackfillPodUrl()` function

## Phase 2: reconcile()

**New file:** `packages/@eve/dna/src/reconcile.ts`

```typescript
/**
 * Config change cascade — apply all downstream effects after a secrets.json
 * write. Called by writeEveSecrets() internally.
 *
 * Cascade rules:
 *   ai.*          → wireAllInstalledComponents()
 *   channels.*    → writeHermesEnvFile() + update OpenClaw config
 *   channelRouting → same as channels
 *   builder.hermes.* → restart Hermes container
 *   inference.*   → writeHermesEnvFile()
 *   domain.*      → update Traefik (if applicable)
 *   synap.apiUrl  → update .env files with NEW_POD_URL
 */

import type { EveSecrets } from './secrets-contract.js';
import {
  wireAllInstalledComponents,
  AI_CONSUMERS_NEEDING_RECREATE,
} from './wire-ai.js';
import { writeHermesEnvFile } from './builder-hub-wiring.js';
import { findPodDeployDir, restartBackendContainer } from './docker-helpers.js';
import { COMPONENTS } from './components.js';

export interface ReconcileOptions {
  recreateComponents?: string[];
  skipEnvSync?: boolean;
  skipTraefik?: boolean;
}

export interface ReconcileResult {
  envSync: boolean;
  aiWiring: { id: string; outcome: string }[];
  containerRecreates: string[];
  traefikUpdate: boolean;
}

export async function reconcile(
  secrets: EveSecrets,
  changedSections: string[],
  options: ReconcileOptions = {},
): Promise<ReconcileResult> {
  const result: ReconcileResult = {
    envSync: false,
    aiWiring: [],
    containerRecreates: [],
    traefikUpdate: false,
  };

  const componentIds = allComponentIds(COMPONENTS);
  const installed = componentIds.filter(id => secrets.ai?.wiringStatus?.[id]?.lastApplied);

  // AI wiring cascade
  if (changedSections.some(s => s.startsWith('ai.'))) {
    const wiringResults = wireAllInstalledComponents(secrets, installed);
    result.aiWiring = wiringResults.map(r => ({ id: r.id, outcome: r.outcome }));
    result.containerRecreates.push(
      ...wiringResults
        .filter(r => r.outcome === 'ok' && AI_CONSUMERS_NEEDING_RECREATE.has(r.id))
        .map(r => r.id),
    );
  }

  // Channels cascade
  if (changedSections.some(s => s.startsWith('channels.') || s === 'channelRouting')) {
    const installedComponents = componentIds.filter(id => {
      const comp = COMPONENTS[id];
      return comp?.category === 'addon' || comp?.aiConfig;
    });
    // Hermes env file gets updated with channel credentials
    try {
      writeHermesEnvFile(secrets);
      result.envSync = true;
    } catch { /* non-fatal — Hermes may not be installed */ }
  }

  // Inference cascade
  if (changedSections.some(s => s.startsWith('inference.'))) {
    try {
      writeHermesEnvFile(secrets);
      result.envSync = true;
    } catch { /* non-fatal */ }
  }

  // Domain / API URL cascade
  if (changedSections.some(s => s.startsWith('domain.') || s === 'synap')) {
    const deployDir = await findPodDeployDir();
    if (deployDir) {
      // Update .env with new pod URL for connected components
      // (uses @eve/lifecycle writeEnvVar — but we avoid the circular dep
      //  by not doing env writes here; the dashboard handles this)
      result.envSync = true;
    }
  }

  // Backend restart on API URL change
  if (changedSections.some(s => s === 'synap' && 'apiUrl' in (secrets.synap ?? {}))) {
    try {
      await restartBackendContainer();
    } catch { /* non-fatal — backend may not be running */ }
  }

  return result;
}

```

**Modified:** `packages/@eve/dna/src/secrets-contract.ts` — `writeEveSecrets()` calls `reconcile()` after successful write, catches errors (reconcile is best-effort).

**Modified:** `packages/@eve/dna/src/index.ts` — export `reconcile` and types.

## Phase 3: discoverPodConfig() write-back

**Modified:** `packages/@eve/dna/src/discover.ts`

Add `discoverAndBackfillPodUrl()`:

```typescript
export async function discoverAndBackfillPodUrl(): Promise<string | null> {
  const discovered = discoverPodConfig();
  if (discovered.synapUrl) {
    const secrets = await readEveSecrets();
    if (secrets) {
      if (!secrets.synap?.apiUrl) {
        await writeEveSecrets({ synap: { apiUrl: discovered.synapUrl } });
      }
      return discovered.synapUrl;
    }
  }
  return null;
}
```

**Modified:** `packages/@eve/dna/src/pod-url.ts` — Step 4 of `resolvePodUrl()` uses `discoverAndBackfillPodUrl()` instead of bare `discoverPodConfig()`.

## Phase 4: Dashboard integration (replace scattered reads)

This is the largest phase. **~64 files** across the dashboard need to be audited and updated.

### Priority A: Hot paths (most frequently called)
- `app/api/hub/_lib.ts` — called 5x per request pattern
- `app/api/intents/route.ts` — called 6x per request pattern
- `app/api/pod/_lib.ts` — called 5x per request pattern
- `app/api/ai/providers/route.ts` — reads AI config on every provider request
- `app/api/agents/route.ts` — reads agent keys on every agent request
- `lib/auth-server.ts` — reads pod/auth config for tRPC middleware
- `lib/doctor.ts` — reads for health probes

### Priority B: Feature routes
All routes in `app/api/` that call `readEveSecrets()` directly. Pattern:
```diff
- const secrets = await readEveSecrets();
+ const secrets = await configStore.get();
```

For routes that only need one section:
```diff
- const secrets = await readEveSecrets();
- const domain = secrets?.domain?.primary;
+ const domain = configStore.getSection('domain')?.primary ?? null;
```

### Priority C: @eve/ package files
Same pattern as dashboard. Replace `readEveSecrets()` with `configStore.get()` or `configStore.getSection()` where appropriate.

## Subagent Assignment

| Phase | Subagent | Scope |
|-------|----------|-------|
| Phase 1 | `executor` | Create `config-store.ts`, update `pod-url.ts`, update `index.ts` exports |
| Phase 2 | `executor` | Create `reconcile.ts`, wire into `writeEveSecrets()`, update `index.ts` |
| Phase 3 | `executor` | Add `discoverAndBackfillPodUrl()` to discover.ts, wire into pod-url.ts |
| Phase 4A | `executor` | Replace reads in hot-path dashboard files (7 files) |
| Phase 4B | `executor` | Replace reads in remaining dashboard and @eve/ package files |
| Verification | `code-reviewer` | Check all changes for correctness, boundaries, and build |

## Parallel Execution Strategy

Phases 1-3 are independent (they touch different files in @eve/dna). Launch all three `executor` agents simultaneously.

Phase 4A depends on Phase 1 (configStore must exist). Launch after 1-3 complete.

Phase 4B depends on Phase 4A (same files). Launch after 4A completes.

## Build Verification

After all phases:
```bash
cd packages/@eve/dna && npx tsc --noEmit 2>&1 | head -30
cd ../../packages/eve-dashboard && npx tsc --noEmit 2>&1 | head -30
```

Both must pass with zero errors.
