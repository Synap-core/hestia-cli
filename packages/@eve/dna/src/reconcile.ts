/**
 * Best-effort config change cascade.
 *
 * `writeEveSecrets()` calls this after the secrets file is durably written.
 * Cascades must not throw out of this module: config persistence is the source
 * of truth, and downstream wiring can be retried by explicit dashboard/CLI
 * actions if a component is not installed or Docker is unavailable.
 */

import type { EveSecrets } from './secrets-contract.js';
import { writeHermesEnvFile } from './builder-hub-wiring.js';
import { COMPONENTS } from './components.js';
import { findPodDeployDir, restartBackendContainer } from './docker-helpers.js';
import {
  AI_CONSUMERS_NEEDING_RECREATE,
  wireAllInstalledComponents,
  type WireAiResult,
} from './wire-ai.js';

export interface ReconcileOptions {
  /** Components that should be reported as needing recreation after config change. */
  recreateComponents?: string[];
  /** Skip env/config file sync effects. */
  skipEnvSync?: boolean;
  /** Reserved for callers that handle Traefik themselves. */
  skipTraefik?: boolean;
}

export interface ReconcileResult {
  envSync: boolean;
  aiWiring: Array<Pick<WireAiResult, 'id' | 'outcome' | 'summary'>>;
  containerRecreates: string[];
  traefikUpdate: boolean;
}

function changed(changedSections: string[], section: string): boolean {
  return changedSections.some((s) => s === section || s.startsWith(`${section}.`));
}

function installedAiConsumers(secrets: EveSecrets): string[] {
  const status = secrets.ai?.wiringStatus ?? {};
  const wired = Object.keys(status).filter((id) => status[id]?.lastApplied);
  if (wired.length > 0) return wired;

  // Fresh installs may not have wiringStatus yet. Fall back to known consumers
  // that exist in the component registry so provider updates still materialize.
  const ids = new Set(COMPONENTS.map((component) => component.id));
  return Array.from(AI_CONSUMERS_NEEDING_RECREATE).filter((id) => ids.has(id));
}

async function tryWriteHermesEnv(): Promise<boolean> {
  try {
    await writeHermesEnvFile();
    return true;
  } catch {
    return false;
  }
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

  if (changed(changedSections, 'ai')) {
    const consumers = installedAiConsumers(secrets);
    const wiring = await wireAllInstalledComponents(secrets, consumers);
    result.aiWiring = wiring.map(({ id, outcome, summary }) => ({ id, outcome, summary }));
    result.containerRecreates.push(
      ...wiring
        .filter((item) => item.outcome === 'ok' && AI_CONSUMERS_NEEDING_RECREATE.has(item.id))
        .map((item) => item.id),
    );
  }

  if (!options.skipEnvSync && (
    changed(changedSections, 'channels') ||
    changed(changedSections, 'channelRouting') ||
    changed(changedSections, 'builder') ||
    changed(changedSections, 'inference')
  )) {
    result.envSync = await tryWriteHermesEnv();
    if (changed(changedSections, 'builder')) {
      result.containerRecreates.push('hermes');
    }
  }

  if (changed(changedSections, 'domain') || changed(changedSections, 'synap') || changed(changedSections, 'pod')) {
    const deployDir = findPodDeployDir();
    if (deployDir) {
      result.envSync = true;
      if (restartBackendContainer(deployDir)) {
        result.containerRecreates.push('synap');
      }
    }
  }

  if (options.recreateComponents) {
    result.containerRecreates.push(...options.recreateComponents);
  }

  result.containerRecreates = Array.from(new Set(result.containerRecreates));
  return result;
}
