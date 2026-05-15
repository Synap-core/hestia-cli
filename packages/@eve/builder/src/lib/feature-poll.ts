import type { Task } from '@eve/dna';
import { TaskQueue } from './task-queue.js';
import { TransientError, PollError } from './task-poll.js';
import { PIPELINE_PERSONALITIES } from './pipeline-personalities.js';

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

export interface PipelineEntity {
  id: string;
  title: string;
  workspaceId: string;
  properties: {
    featureStatus?: string;
    storyStatus?: string;
    agent_status?: string;
    context_doc_id?: string | null;
    plan_proposal_id?: string | null;
    last_completed_phase?: string | null;
  };
}

/** @deprecated Use PipelineEntity */
export type DevplaneFeature = PipelineEntity;

interface FeatureSyncResponse {
  entities: PipelineEntity[];
  since: string;
}

export interface FeaturePollerConfig {
  apiBase: string;
  apiKey: string;
  /**
   * Workspace to scope feature polling to.
   * When omitted, the Hub returns devplane_feature entities from all
   * workspaces the Hermes agent is a member of — workspaces without
   * that profile return nothing automatically.
   */
  workspaceId?: string;
  queue: TaskQueue;
  pollIntervalMs?: number;
  maxRetries?: number;
  backoffMultiplier?: number;
  profileSlug?: 'devplane_feature' | 'devplane_story';
  entityStatusKey?: 'featureStatus' | 'storyStatus';
}

const PHASE_PERSONALITY: Record<PipelinePhase, string> = {
  gather:  'context-gatherer',
  plan:    'planner',
  execute: 'executor',
  verify:  'verifier',
  deploy:  'deployer',
};

function buildPipelineTask(entity: PipelineEntity, phase: PipelinePhase, profileSlug: 'devplane_feature' | 'devplane_story'): Task {
  const now = new Date().toISOString();
  const personality = PIPELINE_PERSONALITIES[PHASE_PERSONALITY[phase]];
  return {
    id: `pipeline:${entity.id}:${phase}:${Date.now()}`,
    title: `[${phase}] ${entity.title}`,
    description: personality?.systemPrompt,
    type: phase === 'execute' ? 'code-gen' : 'custom',
    assignedAgentId: PHASE_PERSONALITY[phase],
    status: 'pending',
    priority: 'high',
    context: {
      isPipelineTask: true,
      phase,
      featureId: entity.id,
      entityId: entity.id,
      entityType: profileSlug,
      workspaceId: entity.workspaceId,
      contextDocId: entity.properties.context_doc_id ?? undefined,
      planProposalId: entity.properties.plan_proposal_id ?? undefined,
      engine: phase === 'execute' ? 'claudecode' : undefined,
      env: {
        HERMES_ENTITY_ID: entity.id,
        HERMES_ENTITY_TYPE: profileSlug,
        HERMES_WORKSPACE_ID: entity.workspaceId,
        HERMES_CONTEXT_DOC_ID: entity.properties.context_doc_id ?? '',
        HERMES_PLAN_PROPOSAL_ID: entity.properties.plan_proposal_id ?? '',
      },
    },
    metadata: {
      createdAt: now,
      updatedAt: now,
    },
  };
}

/**
 * Returns the pipeline phase to trigger given an entity in "idle" agent state.
 * Only entities with entityStatusKey === "in-progress" are eligible.
 */
function resolveTriggerPhase(entity: PipelineEntity, entityStatusKey: string): PipelinePhase | null {
  const entityStatus = (entity.properties as Record<string, unknown>)[entityStatusKey];
  if (entityStatus !== 'in-progress') return null;

  const { context_doc_id, plan_proposal_id, last_completed_phase } = entity.properties;

  if (!context_doc_id) return 'gather';
  if (!plan_proposal_id) return 'plan';

  const last = last_completed_phase ?? null;
  if (last !== 'execute' && last !== 'verify') return 'execute';
  if (last === 'execute') return 'verify';
  if (last === 'verify') return 'deploy';
  return null;
}

export class FeaturePoller {
  private apiBase: string;
  private apiKey: string;
  private workspaceId: string | undefined;
  private queue: TaskQueue;
  private pollIntervalMs: number;
  private maxRetries: number;
  private backoffMultiplier: number;
  private profileSlug: 'devplane_feature' | 'devplane_story';
  private entityStatusKey: 'featureStatus' | 'storyStatus';

  private lastSince = '0';
  private retryCount = 0;
  private currentBackoff = 0;

  /** entityId → last known agent_status, to detect transitions into "idle" */
  private lastKnownAgentStatus = new Map<string, string>();
  /** entityId:phase combinations already enqueued this daemon lifetime */
  private enqueuedCombinations = new Set<string>();

  constructor(config: FeaturePollerConfig) {
    this.apiBase = config.apiBase;
    this.apiKey = config.apiKey;
    this.workspaceId = config.workspaceId;
    this.queue = config.queue;
    this.pollIntervalMs = config.pollIntervalMs ?? 30_000;
    this.maxRetries = config.maxRetries ?? 5;
    this.backoffMultiplier = config.backoffMultiplier ?? 2;
    this.profileSlug = config.profileSlug ?? 'devplane_feature';
    this.entityStatusKey = config.entityStatusKey ?? 'featureStatus';
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
    url.searchParams.set('profileSlug', this.profileSlug);
    if (this.workspaceId) url.searchParams.set('workspaceId', this.workspaceId);
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

    const entities = data.entities ?? [];
    let enqueued = 0;

    for (const entity of entities) {
      const agentStatus = entity.properties.agent_status ?? 'idle';

      if (agentStatus !== 'idle') {
        this.lastKnownAgentStatus.set(entity.id, agentStatus);
        continue;
      }

      const prevStatus = this.lastKnownAgentStatus.get(entity.id);
      this.lastKnownAgentStatus.set(entity.id, agentStatus);

      if (prevStatus === 'blocked' && agentStatus === 'idle') {
        (['gather', 'plan', 'execute', 'verify', 'deploy'] as PipelinePhase[]).forEach(p =>
          this.enqueuedCombinations.delete(`${entity.id}:${p}`)
        );
      }

      // Only act on a transition into "idle" (or first sight of an eligible
      // entity — covers daemon restart with in-flight entities).
      if (prevStatus === 'idle') continue;

      const phase = resolveTriggerPhase(entity, this.entityStatusKey);
      if (!phase) continue;

      const dedupKey = `${entity.id}:${phase}`;
      if (this.enqueuedCombinations.has(dedupKey)) continue;

      const task = buildPipelineTask(entity, phase, this.profileSlug);
      const accepted = this.queue.enqueue(task);
      if (accepted) {
        this.enqueuedCombinations.add(dedupKey);
        enqueued++;
        console.log(
          `[FeaturePoller] Enqueued ${phase} task for entity ${entity.id} ("${entity.title}")`,
        );
      } else {
        console.warn(
          `[FeaturePoller] Queue full — skipped ${phase} task for entity ${entity.id}`,
        );
      }
    }

    return enqueued;
  }
}
