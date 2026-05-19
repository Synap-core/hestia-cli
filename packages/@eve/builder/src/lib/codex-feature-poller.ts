import { CodexPipeline, type CodePhase } from './codex-pipeline.js';
import { PollError, TransientError } from './task-poll.js';

const CODE_PHASES: readonly CodePhase[] = ['executing', 'verifying', 'debugging'] as const;

const PHASE_TIMEOUT_MS: Record<CodePhase, number> = {
  executing: 45 * 60_000,
  verifying: 15 * 60_000,
  debugging: 45 * 60_000,
};

export interface CodexPollerConfig {
  hubBaseUrl: string;
  apiKey: string;
  t3codeUrl: string;
  t3codeApiKey?: string;
  pollIntervalMs?: number;
}

interface FeatureRow {
  id: string;
  title?: string | null;
  properties: Record<string, unknown>;
}

/**
 * Daemon that polls Hub Protocol for devplane_feature entities in code
 * execution phases (executing / verifying / debugging) and dispatches each
 * to CodexPipeline which runs the actual Codex session via T3 Code.
 *
 * Coordination with the backend Hermes trigger worker:
 *   backend worker  → gathering_context, planning (Hermes)
 *   this poller     → executing, verifying, debugging (T3 Code / Codex)
 *
 * Double-dispatch prevention: features are marked agent_status=dispatched
 * BEFORE the CodexPipeline call. The backend worker's SQL query excludes
 * gathering_context+planning phases from dispatched check; this poller
 * excludes code phases from its query entirely when already dispatched.
 */
export class CodexFeaturePoller {
  private readonly pipeline: CodexPipeline;
  private readonly hubBaseUrl: string;
  private readonly apiKey: string;
  private readonly pollIntervalMs: number;
  private readonly active = new Set<string>(); // featureId:phase in-flight
  private running = false;

  constructor(config: CodexPollerConfig) {
    this.hubBaseUrl = config.hubBaseUrl.replace(/\/$/, '');
    this.apiKey = config.apiKey;
    this.pollIntervalMs = config.pollIntervalMs ?? 15_000;
    this.pipeline = new CodexPipeline({
      t3codeUrl: config.t3codeUrl,
      t3codeApiKey: config.t3codeApiKey,
      hubBaseUrl: config.hubBaseUrl,
      apiKey: config.apiKey,
    });
  }

  async start(): Promise<void> {
    this.running = true;
    console.log(`[CodexPoller] Started — polling every ${this.pollIntervalMs / 1000}s`);
    console.log(`[CodexPoller] Handling phases: ${CODE_PHASES.join(', ')}`);

    while (this.running) {
      try {
        await this.tick();
      } catch (err) {
        if (!(err instanceof TransientError)) {
          console.error('[CodexPoller] Tick error:', err);
        }
      }
      await sleep(this.pollIntervalMs);
    }
    console.log('[CodexPoller] Stopped');
  }

  stop(): void {
    this.running = false;
  }

  private async tick(): Promise<void> {
    await this.checkTimeouts();

    const features = await this.fetchCodePhaseFeatures();
    for (const feature of features) {
      const phase = feature.properties.agent_status as CodePhase;
      const key = `${feature.id}:${phase}`;
      if (this.active.has(key)) continue;

      this.active.add(key);
      // Mark dispatched synchronously before forking so the next poll cycle
      // won't double-dispatch if the pipeline call takes longer than one tick.
      await this.markDispatched(feature.id, phase);

      this.pipeline
        .runPhase(feature.id, phase)
        .catch((err) =>
          console.error(`[CodexPoller] runPhase failed for feature ${feature.id}:`, err),
        )
        .finally(() => this.active.delete(key));
    }
  }

  private async fetchCodePhaseFeatures(): Promise<FeatureRow[]> {
    const url = new URL(`${this.hubBaseUrl}/entities`);
    url.searchParams.set('profileSlug', 'devplane_feature');
    url.searchParams.set('limit', '5');

    let res: Response;
    try {
      res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
    } catch (err) {
      throw new TransientError(`Network error: ${(err as Error).message}`);
    }

    if (res.status === 429 || res.status >= 500) throw new TransientError(`HTTP ${res.status}`);
    if (!res.ok) throw new PollError(`HTTP ${res.status}: ${res.statusText}`);

    const data = (await res.json()) as { entities?: FeatureRow[] };
    return (data.entities ?? []).filter((e) =>
      (CODE_PHASES as readonly string[]).includes(e.properties.agent_status as string),
    );
  }

  private async checkTimeouts(): Promise<void> {
    const url = new URL(`${this.hubBaseUrl}/entities`);
    url.searchParams.set('profileSlug', 'devplane_feature');
    url.searchParams.set('agentStatus', 'dispatched');
    url.searchParams.set('limit', '20');

    try {
      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      if (!res.ok) return;

      const data = (await res.json()) as { entities?: FeatureRow[] };
      for (const feature of data.entities ?? []) {
        const phase = feature.properties.agent_phase as CodePhase | undefined;
        const dispatchedAt = feature.properties.dispatched_at as string | undefined;
        // Only handle code phases — Hermes phases are timed out by the backend worker
        if (!phase || !(CODE_PHASES as readonly string[]).includes(phase)) continue;
        if (!dispatchedAt) continue;

        const age = Date.now() - new Date(dispatchedAt).getTime();
        const timeout = PHASE_TIMEOUT_MS[phase];
        if (age > timeout) {
          console.warn(
            `[CodexPoller] ${phase} timed out for feature ${feature.id} (${Math.round(age / 60_000)}min)`,
          );
          await this.markError(feature.id, `${phase}_timeout`);
        }
      }
    } catch {
      // best-effort — don't block the poll loop
    }
  }

  private async markDispatched(featureId: string, phase: CodePhase): Promise<void> {
    await this.patch(featureId, {
      agent_status: 'dispatched',
      agent_phase: phase,
      dispatched_at: new Date().toISOString(),
    });
  }

  private async markError(featureId: string, reason: string): Promise<void> {
    await this.patch(featureId, { agent_status: 'error', error_reason: reason });
  }

  private async patch(featureId: string, properties: Record<string, unknown>): Promise<void> {
    await fetch(`${this.hubBaseUrl}/entities/${featureId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ properties }),
    }).catch(() => {});
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
