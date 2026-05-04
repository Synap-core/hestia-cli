/**
 * Background-task action registry — client-safe mirror.
 *
 * SYNC NOTE
 * ---------
 * This is a deliberate mirror of the canonical registry maintained inside
 * synap-backend at:
 *   synap-backend/packages/api/src/services/background-task-actions.ts
 *
 * It is also mirrored in `@eve/dna/src/background-task-actions.ts` for the
 * CLI. We copy the data again here because `@eve/dna`'s barrel pulls in
 * node-only modules (fs, child_process) that webpack can't ship to the
 * browser. Adding an action means updating: (1) the backend file, (2) the
 * @eve/dna mirror, (3) THIS file. The backend remains authoritative —
 * its rejection envelope returns the full registry on 400 if any of the
 * three drift.
 *
 * Validate at the API route boundary; this file is for UI hints only.
 */

export interface DashboardBackgroundAction {
  id: string;
  description: string;
  requiresEntity?: boolean;
  requiresWorkspace?: boolean;
}

export const DASHBOARD_BACKGROUND_ACTIONS: Record<
  string,
  DashboardBackgroundAction
> = {
  "coder.research": {
    id: "coder.research",
    description: "Research a topic, write findings to a Note entity",
  },
  "coder.build": {
    id: "coder.build",
    description: "Build/scaffold code in a project workspace",
    requiresWorkspace: true,
  },
  "coder.review": {
    id: "coder.review",
    description: "Review code in a project",
    requiresWorkspace: true,
  },
  "coder.refactor": {
    id: "coder.refactor",
    description: "Refactor code in a project",
    requiresWorkspace: true,
  },
  "hermes.summarize": {
    id: "hermes.summarize",
    description: "Summarize entities or conversations",
  },
  "hermes.digest": {
    id: "hermes.digest",
    description: "Generate daily/weekly digest",
  },
  "eve.healthcheck": {
    id: "eve.healthcheck",
    description: "Run periodic eve-doctor probes",
  },
  "openclaw.skill": {
    id: "openclaw.skill",
    description: "Invoke a named OpenClaw skill",
  },
  custom: {
    id: "custom",
    description: "Free-form NL prompt (escape hatch)",
  },
};

export type BackgroundTaskType = "cron" | "event" | "interval";
export type BackgroundTaskStatus = "active" | "paused" | "error";

export interface BackgroundTask {
  id: string;
  userId: string;
  workspaceId: string | null;
  name: string;
  description: string | null;
  type: BackgroundTaskType;
  schedule: string | null;
  action: string;
  context: Record<string, unknown>;
  status: BackgroundTaskStatus;
  errorMessage: string | null;
  lastRunAt: string | null;
  nextRunAt: string | null;
  executionCount: number;
  successCount: number;
  failureCount: number;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}
