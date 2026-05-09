/**
 * Centralized config store — single in-memory cache for secrets.json reads.
 *
 * Per-process singleton. Lazy-load on first access. Cache invalidation via
 * reload() (called after writes) or reset() (test hook).
 */

import type { EveSecrets } from './secrets-contract.js';
import { readEveSecrets } from './secrets-contract.js';

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
    for (const sub of subscribers) {
      try { sub(secrets); } catch { /* subscriber errors don't break reload */ }
    }
    return secrets;
  } catch {
    cache.secrets = null;
    cache.loadedAt = Date.now();
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
    if (cache.secrets !== null) return cache.secrets;
    return _load();
  },

  getSection<K extends keyof EveSecrets>(key: K): EveSecrets[K] | null {
    if (cache.secrets === null) return null;
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
