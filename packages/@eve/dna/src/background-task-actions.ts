/**
 * Background Task Action Registry — Eve mirror.
 *
 * SYNC NOTE
 * ---------
 * This is a deliberate mirror of the canonical registry maintained inside
 * synap-backend at:
 *   synap-backend/packages/api/src/services/background-task-actions.ts
 *
 * The backend is the source of truth — every entry here MUST match a row
 * there. The mirror exists only so the Eve CLI can pre-flight a user's
 * `--action` flag locally (faster feedback, no round-trip to the pod for
 * obvious typos). When the backend rejects an unknown id it returns the
 * full registry in the 400 envelope; that path remains the authoritative
 * validator.
 *
 * Adding an action: update the backend file FIRST, ship it, then mirror
 * the row here. Never the other way round — a CLI that pretends to know
 * about an action the pod doesn't will fail later, which is worse than
 * a missing pre-flight check.
 */

export interface EveBackgroundTaskAction {
  /** Stable identifier — what callers send as `action`. Namespaced by runner. */
  id: string;
  /** Short human description (rendered in CLI listings). */
  description: string;
  /** When true, the task's `context` MUST include an `entityId`. */
  requiresEntity?: boolean;
  /** When true, the task MUST be associated with a workspace. */
  requiresWorkspace?: boolean;
}

/**
 * Mirror of `BACKGROUND_TASK_ACTIONS` in
 * `synap-backend/packages/api/src/services/background-task-actions.ts`.
 */
export const EVE_BACKGROUND_ACTIONS: Record<string, EveBackgroundTaskAction> = {
  'coder.research': {
    id: 'coder.research',
    description: 'Research a topic, write findings to a Note entity',
  },
  'coder.build': {
    id: 'coder.build',
    description: 'Build/scaffold code in a project workspace',
    requiresWorkspace: true,
  },
  'coder.review': {
    id: 'coder.review',
    description: 'Review code in a project',
    requiresWorkspace: true,
  },
  'coder.refactor': {
    id: 'coder.refactor',
    description: 'Refactor code in a project',
    requiresWorkspace: true,
  },
  'hermes.summarize': {
    id: 'hermes.summarize',
    description: 'Summarize entities or conversations',
  },
  'hermes.digest': {
    id: 'hermes.digest',
    description: 'Generate daily/weekly digest',
  },
  'eve.healthcheck': {
    id: 'eve.healthcheck',
    description: 'Run periodic eve-doctor probes',
  },
  'openclaw.skill': {
    id: 'openclaw.skill',
    description: 'Invoke a named OpenClaw skill',
  },
  custom: {
    id: 'custom',
    description: 'Free-form NL prompt (escape hatch)',
  },
};

/** True iff the id is a registered action in the local mirror. */
export function isValidEveBackgroundAction(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(EVE_BACKGROUND_ACTIONS, id);
}

/** Just `{id, description}` pairs — for help text and listing. */
export function listEveBackgroundActions(): Array<{
  id: string;
  description: string;
}> {
  return Object.values(EVE_BACKGROUND_ACTIONS).map(({ id, description }) => ({
    id,
    description,
  }));
}

/**
 * Pick the synthetic assignee slug for a given action id, used by the
 * Hermes daemon when materialising a background task into an in-memory
 * `Task` object for dispatch.
 *
 * Mapping is by namespace prefix:
 *   coder.*     → "coder"
 *   hermes.*    → "hermes"
 *   eve.*       → "eve"
 *   openclaw.*  → "openclaw"
 *   custom      → "hermes"  (free-form prompts go to the orchestrator)
 *
 * Unknown / namespaceless actions also fall back to "hermes" — the
 * orchestrator is the safe default because it can interpret arbitrary
 * prompts via the standard agent loop.
 */
export function assigneeForAction(actionId: string): string {
  if (actionId === 'custom') return 'hermes';
  const dot = actionId.indexOf('.');
  if (dot < 0) return 'hermes';
  const ns = actionId.slice(0, dot);
  switch (ns) {
    case 'coder':
      return 'coder';
    case 'hermes':
      return 'hermes';
    case 'eve':
      return 'eve';
    case 'openclaw':
      return 'openclaw';
    default:
      return 'hermes';
  }
}
