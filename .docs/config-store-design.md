# Centralized Config Store — Design Document

## Problem Statement

`secrets.json` (`~/.eve/secrets/secrets.json`) is the canonical config store for the entire Eve platform, covering providers, models, channels, domain, agents, inference, builder, CP, and pod configuration. However, the access layer is fragmented:

1. **Reads are scattered across 80+ files** — every route handler, CLI command, and lifecycle module calls `readEveSecrets()` independently, with no in-process cache. In the dashboard (Next.js serverless), secrets.json is read on every request. In CLI and daemon processes, each invocation re-reads the file.
2. **Ad-hoc bypass reads** — `discoverPodConfig()` reads .env files, Traefik configs, and docker inspect output, bypassing secrets.json entirely. This creates semantic inconsistency: two code paths can return different pod URLs for the same deployment.
3. **No change notification system** — writes to secrets.json have no downstream cascade. Each code path that needs to apply config changes re-implements its own subset of effects (.env writes, Traefik updates, container recreates) without a unified orchestrator.

## Design Goals

- **Single source of truth** — all config access goes through one entry point
- **Per-process caching** — secrets.json is read once per process/request lifecycle
- **Write-cascade** — config changes automatically propagate to .env files, component configs, and containers
- **Discovery write-back** — when `discoverPodConfig()` finds a valid URL, it writes it back to secrets.json to prevent future bypass reads
- **Backwards compatible** — existing `readEveSecrets()` and `writeEveSecrets()` signatures are preserved as thin wrappers

## Solution: Three-Part Architecture

### 1. ConfigStore

```typescript
// packages/@eve/dna/src/config-store.ts

interface ConfigStore {
  /** Read the full secrets document. Cached for process lifetime. */
  get(): Promise<EveSecrets | null>;

  /** Read a single top-level section. Cached. */
  getSection<K extends keyof EveSecrets>(key: K): EveSecrets[K] | null;

  /** Force a cache refresh (called after writes). */
  reload(): Promise<void>;

  /** Clear cache entirely (test hook). */
  reset(): void;

  /** Subscribe to change notifications. */
  onChange(fn: (secrets: EveSecrets | null) => void): () => void;
}
```

**Key design decisions:**
- In-memory `Map` cache keyed by secrets file path (defaults to standard path)
- Lazy load on first `get()` call
- `getSection()` avoids destructuring the full object — returns the raw nested shape
- `onChange()` returns an unsubscribe function; fires on reload
- Per-process singleton via module-level export

### 2. reconcile()

```typescript
interface ReconcileOptions {
  /** Components that need container recreation after config change */
  recreateComponents?: string[];
  /** Skip .env file sync */
  skipEnvSync?: boolean;
  /** Skip Traefik config update */
  skipTraefik?: boolean;
}

interface ReconcileResult {
  envSync: boolean;
  aiWiring: WireAiResult[];
  containerRecreates: string[];
  traefikUpdate: boolean;
}

function reconcile(
  secrets: EveSecrets,
  changedSections: string[],
  options?: ReconcileOptions,
): Promise<ReconcileResult>;
```

**cascade rules:**
| Changed Section | Downstream Effects |
|-----------------|-------------------|
| `ai.*` | Re-wire all installed components via `wireAllInstalledComponents()` |
| `channels.*` or `channelRouting` | Re-write Hermes env file, re-write OpenClaw config |
| `builder.hermes.*` | Restart Hermes container |
| `domain.*` or `synap.apiUrl` | Update Traefik routing, restart backend container |
| `inference.*` | Update Hermes env file |
| `agents.*` | No immediate downstream effect (agent keys are consumed at startup) |

### 3. discoverPodConfig() Write-Back

When `discoverPodConfig()` finds a valid `synapUrl` from on-disk artifacts:

```typescript
// In discover.ts
export async function discoverAndBackfillPodUrl(): Promise<string | null> {
  const discovered = discoverPodConfig();
  if (discovered.synapUrl) {
    // Write back to secrets.json so future reads don't need discovery
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

## Migration Path

### Phase 1: ConfigStore skeleton
- Create `config-store.ts` with basic get/reload/reset/onChange
- Wire `resolvePodUrl()` to use ConfigStore instead of calling `readEveSecrets()` directly
- Keep `readEveSecrets()` as thin wrapper that calls `configStore.get()`

### Phase 2: reconcile() in @eve/dna
- Implement cascade logic in `reconcile()` function
- Update `writeEveSecrets()` to call `reconcile()` after successful write
- Add `reconcile()` export to `index.ts`

### Phase 3: discoverPodConfig() write-back
- Add `discoverAndBackfillPodUrl()` to discover.ts
- Wire into `resolvePodUrl()` step 4 (replacing bare `discoverPodConfig()` call)

### Phase 4: Dashboard integration
- Replace all 46 route handlers that call `readEveSecrets()` with `configStore.getSection()`
- Replace direct `discoverPodConfig()` calls with `discoverAndBackfillPodUrl()`

## File Changes Summary

| File | Change |
|------|--------|
| NEW `packages/@eve/dna/src/config-store.ts` | ConfigStore singleton |
| Modified `packages/@eve/dna/src/pod-url.ts` | Use ConfigStore, use discoverAndBackfillPodUrl |
| Modified `packages/@eve/dna/src/discover.ts` | Add discoverAndBackfillPodUrl |
| Modified `packages/@eve/dna/src/secrets-contract.ts` | Call reconcile() after writeEveSecrets |
| Modified `packages/@eve/dna/src/index.ts` | Export ConfigStore and reconcile |
| Modified ~46 dashboard route handlers | Replace readEveSecrets with configStore |
| Modified ~18 @eve/ package files | Replace readEveSecrets with configStore |

## Risks and Mitigations

1. **Singleton lifecycle** — ConfigStore cache lives for process lifetime. In serverless (Next.js API routes), each request is a new process so this is safe. For long-running CLI/daemon processes, `reload()` must be called after external config changes (e.g., another `eve` CLI instance modifies secrets.json).
2. **Backwards compatibility** — All existing `readEveSecrets()` callers continue working because the function delegates to ConfigStore. No caller changes needed in Phases 1-3.
3. **Reconcile side effects** — `reconcile()` triggers container recreates and config writes. Must be carefully gated to only fire on relevant section changes, and callers must have permission to manage containers.
