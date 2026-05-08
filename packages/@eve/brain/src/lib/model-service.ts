import { execa } from './exec.js';

/** A model known to a specific provider. */
export interface ProviderModel {
  /** Model identifier, e.g. "claude-sonnet-4-7" or "llama3.1:8b" */
  name: string;
  /** Whether this is the provider's recommended default */
  isDefault?: boolean;
}

/** All models grouped by provider. */
export interface ProviderModels {
  providerId: string;
  displayName: string;
  /** Model names discovered from the provider's /v1/models or ollama list */
  models: ProviderModel[];
  /** Whether discovery succeeded (false = provider unreachable, models may be stale) */
  available: boolean;
}

/** OpenAI-compatible /v1/models response item. */
interface OpenAIModelItem {
  id: string;
  object: string;
  owned_by?: string;
}

/** Ollama /api/tags response. */
interface OllamaTagsResponse {
  models: Array<{ name: string; size: number; digest: string; details?: Record<string, unknown> }>;
}

/**
 * Discover models from all AI sources: Ollama, Hermes gateway, and
 * cloud providers configured in secrets.
 */
export class ModelService {
  private ollamaContainer = 'eve-brain-ollama';

  /** ── Ollama ────────────────────────────────────────────── */

  /** Check whether the Ollama container is running. */
  async isOllamaRunning(): Promise<boolean> {
    try {
      const { stdout } = await execa('docker', [
        'ps', '--filter', `name=${this.ollamaContainer}`,
        '--filter', 'status=running', '--format', '{{.Names}}',
      ]);
      return stdout.trim() === this.ollamaContainer;
    } catch {
      return false;
    }
  }

  /** List Ollama model names via `docker exec ollama list`. */
  async listOllamaModels(): Promise<string[]> {
    try {
      // Fast path: try HTTP /api/tags first (no docker exec overhead)
      const httpModels = await this.listOllamaModelsHttp();
      if (httpModels.length > 0) return httpModels;
    } catch { /* fall through */ }

    try {
      const { stdout } = await execa('docker', [
        'exec', this.ollamaContainer, 'ollama', 'list',
      ]);
      const lines = stdout.trim().split('\n').slice(1);
      return lines.map(l => l.split(/\s+/)[0]).filter(Boolean);
    } catch {
      return [];
    }
  }

  private async listOllamaModelsHttp(): Promise<string[]> {
    try {
      const res = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(3000) });
      if (!res.ok) return [];
      const data: OllamaTagsResponse = await res.json();
      return (data.models ?? []).map(m => m.name).filter(Boolean);
    } catch {
      return [];
    }
  }

  /** ── Hermes gateway ────────────────────────────────────── */

  /** Check whether the Hermes container is running. */
  async isHermesRunning(): Promise<boolean> {
    try {
      const { stdout } = await execa('docker', [
        'ps', '--filter', 'name=eve-builder-hermes',
        '--filter', 'status=running', '--format', '{{.Names}}',
      ]);
      return stdout.trim() === 'eve-builder-hermes';
    } catch {
      return false;
    }
  }

  /**
   * Query Hermes gateway's /v1/models endpoint.
   * @param apiKey — optional Bearer token (API_SERVER_KEY from secrets)
   */
  async listHermesModels(apiKey?: string): Promise<string[]> {
    if (!await this.isHermesRunning()) return [];

    try {
      const headers: Record<string, string> = {};
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
      const res = await fetch('http://localhost:8642/v1/models', {
        headers,
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return [];
      const data = await res.json();
      const items = Array.isArray(data.data) ? data.data : [];
      return items
        .filter((m: OpenAIModelItem) => m?.id)
        .map((m: OpenAIModelItem) => m.id);
    } catch {
      return [];
    }
  }

  /** ── Cloud providers (OpenAI-compatible /v1/models) ───── */

  /**
   * Query a provider's /v1/models endpoint using its apiKey + baseUrl.
   * Returns model IDs, or empty array if unreachable / no key.
   */
  async listCloudModels(options: {
    baseUrl: string;
    apiKey?: string;
    /** Provider id used for display grouping. */
    providerId?: string;
  }): Promise<string[]> {
    if (!options.apiKey) return [];

    const url = `${options.baseUrl.replace(/\/+$/, '')}/v1/models`;
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${options.apiKey}` },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return [];
      const data = await res.json();
      const items = Array.isArray(data.data) ? data.data : [];
      return items.filter((m: OpenAIModelItem) => m?.id).map((m: OpenAIModelItem) => m.id);
    } catch {
      return [];
    }
  }

  /** ── Unified discovery ─────────────────────────────────── */

  /**
   * Discover models from all sources and return a grouped list.
   *
   * @param cloudProviders — optional list of { id, name, baseUrl, apiKey, defaultModel, models }
   * @param hermesApiKey — optional API_SERVER_KEY for authenticated Hermes model discovery
   * @returns ProviderModels sorted: Ollama first, then Hermes, then cloud providers
   */
  async discoverAll(
    cloudProviders?: Array<{
      id: string;
      name?: string;
      baseUrl?: string;
      apiKey?: string;
      defaultModel?: string;
      /** Cached model list from a previous successful discovery. */
      models?: string[];
    }>,
    hermesApiKey?: string,
  ): Promise<ProviderModels[]> {
    const results: ProviderModels[] = [];

    // 1. Ollama
    const ollamaRunning = await this.isOllamaRunning();
    const ollamaModels = ollamaRunning ? await this.listOllamaModels() : [];
    if (ollamaModels.length > 0 || ollamaRunning) {
      results.push({
        providerId: 'ollama',
        displayName: 'Ollama (local)',
        models: ollamaModels.map(name => ({ name, isDefault: ollamaModels[0] === name })),
        available: ollamaRunning,
      });
    }

    // 2. Hermes gateway
    const hermesRunning = await this.isHermesRunning();
    const hermesModels = hermesRunning
      ? await this.listHermesModels(hermesApiKey)
      : [];
    if (hermesModels.length > 0 || hermesRunning) {
      results.push({
        providerId: 'hermes',
        displayName: 'Hermes Gateway',
        models: hermesModels.map(name => ({ name, isDefault: hermesModels[0] === name })),
        available: hermesRunning,
      });
    }

    // 3. Cloud providers (including custom providers)
    if (cloudProviders) {
      for (const cp of cloudProviders) {
        // Skip if we have nothing to work with
        const canDiscover = !!(cp.baseUrl && cp.apiKey);
        const hasCachedModels = cp.models && cp.models.length > 0;
        if (!canDiscover && !hasCachedModels) continue;

        let models: string[] = [];
        let available = false;

        if (canDiscover) {
          models = await this.listCloudModels({
            baseUrl: cp.baseUrl ?? '',
            apiKey: cp.apiKey,
            providerId: cp.id,
          });
          available = true;
        }

        // Fallback to cached models when discovery fails or isn't possible
        if (models.length === 0 && hasCachedModels) {
          models = cp.models ?? [];
          available = false; // Mark as cached/unverified so CLI shows "(cached)"
        }

        results.push({
          providerId: cp.id,
          displayName: cp.name ?? cp.id,
          models: models.map(name => ({ name, isDefault: name === cp.defaultModel })),
          available,
        });
      }
    }

    return results;
  }
}
