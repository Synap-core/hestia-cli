/**
 * Centralized config store — single in-memory cache for secrets.json reads.
 *
 * Per-process singleton. Lazy-load on first access. Cache invalidation via
 * reload() (called after writes) or reset() (test hook).
 */

import type { EveSecrets } from './secrets-contract.js';
import { readEveSecretsFromDisk, secretsPath } from './secrets-contract.js';

interface CacheEntry {
  secrets: EveSecrets | null;
  loadedAt: number;
}

interface Subscriber {
  (secrets: EveSecrets | null): void;
}

const cache = new Map<string, CacheEntry>();
const subscribers: Subscriber[] = [];

function cacheKey(cwd?: string): string {
  return secretsPath(cwd);
}

async function _load(cwd?: string): Promise<EveSecrets | null> {
  const key = cacheKey(cwd);
  try {
    const secrets = await readEveSecretsFromDisk(cwd);
    cache.set(key, { secrets, loadedAt: Date.now() });
    for (const sub of subscribers) {
      try { sub(secrets); } catch { /* subscriber errors don't break reload */ }
    }
    return secrets;
  } catch {
    cache.set(key, { secrets: null, loadedAt: Date.now() });
    return null;
  }
}

export interface ConfigStore {
  get(cwd?: string): Promise<EveSecrets | null>;
  getSection<K extends keyof EveSecrets>(key: K, cwd?: string): EveSecrets[K] | null;
  reload(cwd?: string): Promise<void>;
  reset(cwd?: string): void;
  onChange(fn: Subscriber): () => void;
}

export const configStore: ConfigStore = {
  async get(cwd?: string): Promise<EveSecrets | null> {
    const entry = cache.get(cacheKey(cwd));
    if (entry && entry.loadedAt > 0) return entry.secrets;
    return _load(cwd);
  },

  getSection<K extends keyof EveSecrets>(key: K, cwd?: string): EveSecrets[K] | null {
    const entry = cache.get(cacheKey(cwd));
    if (!entry?.secrets) return null;
    return entry.secrets[key] ?? null;
  },

  async reload(cwd?: string): Promise<void> {
    await _load(cwd);
  },

  reset(cwd?: string): void {
    if (cwd) {
      cache.delete(cacheKey(cwd));
      return;
    }
    cache.clear();
  },

  onChange(fn: Subscriber): () => void {
    subscribers.push(fn);
    return () => {
      const idx = subscribers.indexOf(fn);
      if (idx >= 0) subscribers.splice(idx, 1);
    };
  },
};
