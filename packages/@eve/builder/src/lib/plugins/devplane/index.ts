import { FeaturePoller } from '../../feature-poll.js';
import { TaskQueue } from '../../task-queue.js';
import type { EvePoller } from '../../poller-interface.js';

export interface DevPlanePluginConfig {
  apiBase: string;
  apiKey: string;
  queue: TaskQueue;
  pollIntervalMs?: number;
}

/**
 * Factory that creates an EvePoller wrapping the built-in FeaturePoller.
 * Use this when you need to instantiate a DevPlane plugin as an external
 * poller rather than relying on the FeaturePoller built into HermesDaemon.
 */
export function createDevPlanePlugin(config: DevPlanePluginConfig): EvePoller {
  const poller = new FeaturePoller({
    apiBase: config.apiBase,
    apiKey: config.apiKey,
    queue: config.queue,
    pollIntervalMs: config.pollIntervalMs,
  });

  return {
    pollOnce(): Promise<number> {
      return poller.pollOnce();
    },
  };
}
