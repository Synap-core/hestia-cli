import type { Task } from '@eve/dna';
import { TaskQueue } from './task-queue.js';
import { TransientError, PollError } from './task-poll.js';

export type PipelinePhase = 'gather' | 'plan' | 'execute' | 'verify' | 'deploy';

// agent_status values written to devplane_feature.properties.agent_status
const PHASE_RUNNING_STATUS: Record<PipelinePhase, string> = {
  gather:  'gathering_context',
  plan:    'planning',
  execute: 'executing',
  verify:  'verifying',
  deploy:  'deploying',
};

// agent_status to set after a phase succeeds (null = set by human approval gate)
const PHASE_SUCCESS_STATUS: Record<PipelinePhase, string> = {
  gather:  'idle',                      // triggers plan on next poll
  plan:    'awaiting_plan_approval',    // human Gate 1
  execute: 'idle',                      // triggers verify on next poll
  verify:  'awaiting_deploy_approval',  // human Gate 2
  deploy:  'done',
};

export interface DevplaneFeature {
  id: string;
  title: string;
  workspaceId: string;
  properties: {
    featureStatus?: string;
    agent_status?: string;
    context_doc_id?: string | null;
    plan_proposal_id?: string | null;
  };
}

interface FeatureSyncResponse {
  entities: DevplaneFeature[];
  since: string;
}

export interface FeaturePollerConfig {
  apiBase: string;
  apiKey: string;
  workspaceId: string;
  queue: TaskQueue;
  pollIntervalMs?: number;
  maxRetries?: number;
  backoffMultiplier?: number;
}

const PHASE_PERSONALITY: Record<PipelinePhase, string> = {
  gather:  'context-gatherer',
  plan:    'planner',
  execute: 'executor',
  verify:  'verifier',
  deploy:  'deployer',
};

const PHASE_COMMAND: Partial<Record<PipelinePhase, string>> = {
  gather:
    'Read the feature description, linked app tech stack, decision records, best practices, and codebase map from Synap. Write a structured context document back to the feature AI channel.',
  plan:
    'Read the context document from the feature AI channel. Generate a detailed implementation plan as a numbered task list with file paths, approach, and test strategy. Write it back as a Synap Proposal.',
  verify:
    'Run the test suite, type checker, and linter. Write a structured report (pass/fail per check, issues found) back to the feature AI channel.',
  deploy:
    'Trigger the Coolify staging deployment recipe for the linked app. Monitor until completion and write the deployment result back.',
};

function buildPipelineTask(feature: DevplaneFeature, phase: PipelinePhase): Task {
  const now = new Date().toISOString();
  return {
    id: `pipeline:${feature.id}:${phase}:${Date.now()}`,
    title: `[${phase}] ${feature.title}`,
    type: phase === 'execute' ? 'code-gen' : 'custom',
    assignedAgentId: PHASE_PERSONALITY[phase],
    status: 'pending',
    priority: 'high',
    context: {
      isPipelineTask: true,
      phase,
      featureId: feature.id,
      featureTitle: feature.title,
      workspaceId: feature.workspaceId,
      contextDocId: feature.properties.context_doc_id ?? undefined,
      planProposalId: feature.properties.plan_proposal_id ?? undefined,
      engine: phase === 'execute' ? 'claudecode' : undefined,
      customCommand: PHASE_COMMAND[phase],
    },
    metadata: {
      createdAt: now,
      updatedAt: now,
    },
  };
}

/**
 * Returns the pipeline phase to trigger given a feature in "idle" agent state.
 * DevPlane's kanban uses featureStatus values: "planned" | "in-progress" | "done" | "error".
 * Only "in-progress" features are eligible — the phase depends on what context already exists.
 */
function resolveTriggerPhase(feature: DevplaneFeature): PipelinePhase | null {
  const { featureStatus, context_doc_id, plan_proposal_id } = feature.properties;

  if (featureStatus !== 'in-progress') return null;

  if (!context_doc_id) return 'gather';
  if (!plan_proposal_id) return 'plan';
  return 'execute';
}

export class FeaturePoller {
  private apiBase: string;
  private apiKey: string;
  private workspaceId: string;
  private queue: TaskQueue;
  private pollIntervalMs: number;
  private maxRetries: number;
  private backoffMultiplier: number;

  private lastSince = '0';
  private retryCount = 0;
  private currentBackoff = 0;

  /** featureId → last known agent_status, to detect transitions into "idle" */
  private lastKnownAgentStatus = new Map<string, string>();
  /** featureId:phase combinations already enqueued this daemon lifetime */
  private enqueuedCombinations = new Set<string>();

  constructor(config: FeaturePollerConfig) {
    this.apiBase = config.apiBase;
    this.apiKey = config.apiKey;
    this.workspaceId = config.workspaceId;
    this.queue = config.queue;
    this.pollIntervalMs = config.pollIntervalMs ?? 30_000;
    this.maxRetries = config.maxRetries ?? 5;
    this.backoffMultiplier = config.backoffMultiplier ?? 2;
  }

  getBackoffMs(): number {
    return this.currentBackoff;
  }

  resetCursor(): void {
    this.lastSince = '0';
    this.retryCount = 0;
    this.currentBackoff = 0;
  }

  async updateFeatureAgentStatus(featureId: string, agentStatus: string): Promise<void> {
    const url = `${this.apiBase}/api/hub/entities/${featureId}`;
    try {
      await fetch(url, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ properties: { agent_status: agentStatus } }),
      });
    } catch (error) {
      console.warn(
        `[FeaturePoller] Failed to update agent_status for ${featureId}: ${(error as Error).message}`,
      );
    }
  }

  phaseRunningStatus(phase: PipelinePhase): string {
    return PHASE_RUNNING_STATUS[phase];
  }

  phaseSuccessStatus(phase: PipelinePhase): string {
    return PHASE_SUCCESS_STATUS[phase];
  }

  async pollOnce(): Promise<number> {
    const url = new URL(`${this.apiBase}/api/hub/entities`);
    url.searchParams.set('profileSlug', 'devplane_feature');
    url.searchParams.set('workspaceId', this.workspaceId);
    url.searchParams.set('since', this.lastSince);
    url.searchParams.set('limit', '100');

    let data: FeatureSyncResponse;
    try {
      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        data = (await response.json()) as FeatureSyncResponse;
        this.retryCount = 0;
        this.currentBackoff = 0;
        this.lastSince = data.since || this.lastSince;
      } else if (response.status === 429 || response.status >= 500) {
        this.retryCount++;
        this.currentBackoff = Math.min(
          this.pollIntervalMs * Math.pow(this.backoffMultiplier, this.retryCount),
          5 * 60 * 1000,
        );
        throw new TransientError(`HTTP ${response.status}: ${response.statusText}`);
      } else {
        throw new PollError(`HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      if (error instanceof TransientError) {
        if (this.retryCount >= this.maxRetries) {
          throw new PollError(
            `[FeaturePoller] Max retries (${this.maxRetries}) exceeded after transient error`,
          );
        }
        throw error;
      }
      if (error instanceof PollError) throw error;
      throw new PollError(`[FeaturePoller] Network error: ${(error as Error).message}`);
    }

    const features = data.entities ?? [];
    let enqueued = 0;

    for (const feature of features) {
      const agentStatus = feature.properties.agent_status ?? 'idle';

      if (agentStatus !== 'idle') {
        this.lastKnownAgentStatus.set(feature.id, agentStatus);
        continue;
      }

      const prevStatus = this.lastKnownAgentStatus.get(feature.id);
      this.lastKnownAgentStatus.set(feature.id, agentStatus);

      // Only act on a transition into "idle" (or first sight of an eligible
      // feature — covers daemon restart with in-flight features).
      if (prevStatus === 'idle') continue;

      const phase = resolveTriggerPhase(feature);
      if (!phase) continue;

      const dedupKey = `${feature.id}:${phase}`;
      if (this.enqueuedCombinations.has(dedupKey)) continue;

      const task = buildPipelineTask(feature, phase);
      const accepted = this.queue.enqueue(task);
      if (accepted) {
        this.enqueuedCombinations.add(dedupKey);
        enqueued++;
        console.log(
          `[FeaturePoller] Enqueued ${phase} task for feature ${feature.id} ("${feature.title}")`,
        );
      } else {
        console.warn(
          `[FeaturePoller] Queue full — skipped ${phase} task for feature ${feature.id}`,
        );
      }
    }

    return enqueued;
  }
}
