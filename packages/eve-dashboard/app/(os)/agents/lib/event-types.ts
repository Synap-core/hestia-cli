/**
 * Typed event registry for the Agents app.
 *
 * Mirrors the 6 `{actor}:{entity}:{action}` events emitted by the pod
 * (synap-backend/packages/realtime/src/realtime-schemas.ts). Kept in
 * sync by hand for now — when `@synap/events` is publishable as an
 * npm package, swap this module for the import.
 *
 * See: synap-team-docs/content/team/platform/eve-agents-design.mdx
 *      synap-team-docs/content/team/platform/event-chain.mdx
 */

export const EVENT_NAMES = [
  "openclaw:message:received",
  "synap:reply:routed",
  "hermes:task:queued",
  "hermes:task:started",
  "hermes:task:completed",
  "hermes:task:failed",
] as const;

export type EventName = (typeof EVENT_NAMES)[number];

// Per-event payload shapes — must match the pod's Zod schemas.
export interface OpenclawMessageReceived {
  channelId: string;
  messageId: string;
  platform: "telegram" | "discord" | "whatsapp" | "signal" | string;
  excerpt?: string;
  receivedAt: string;
}

export interface SynapReplyRouted {
  channelId: string;
  messageId: string;
  targetPlatform: string;
  excerpt?: string;
  routedAt: string;
}

export interface HermesTaskQueued {
  taskId: string;
  kind: string;
  source?: string;
  queuedAt: string;
}

export interface HermesTaskStarted {
  taskId: string;
  kind: string;
  startedAt: string;
}

export interface HermesTaskCompleted {
  taskId: string;
  durationMs?: number;
  completedAt: string;
}

export interface HermesTaskFailed {
  taskId: string;
  error?: string;
  failedAt: string;
}

export type EventPayload =
  | { name: "openclaw:message:received"; data: OpenclawMessageReceived }
  | { name: "synap:reply:routed"; data: SynapReplyRouted }
  | { name: "hermes:task:queued"; data: HermesTaskQueued }
  | { name: "hermes:task:started"; data: HermesTaskStarted }
  | { name: "hermes:task:completed"; data: HermesTaskCompleted }
  | { name: "hermes:task:failed"; data: HermesTaskFailed };

/** Wrapping shape for the Timeline + Flow buffers. */
export interface AgentEvent {
  /** Stable client-side ID (event name + a monotonic counter). */
  id: string;
  name: EventName;
  /** ISO timestamp normalized from the per-event payload. */
  at: string;
  /** Original payload, untyped here so callers can narrow per name. */
  payload: unknown;
}

/** Pull a timestamp out of any event payload, falling back to "now". */
export function timestampFor(name: EventName, payload: unknown): string {
  const obj = (payload ?? {}) as Record<string, unknown>;
  const candidate =
    obj.receivedAt ??
    obj.routedAt ??
    obj.queuedAt ??
    obj.startedAt ??
    obj.completedAt ??
    obj.failedAt;
  if (typeof candidate === "string") return candidate;
  return new Date().toISOString();
}

/** Derive a one-line excerpt for the timeline row from any payload. */
export function excerptFor(name: EventName, payload: unknown): string | undefined {
  const obj = (payload ?? {}) as Record<string, unknown>;
  if (typeof obj.excerpt === "string" && obj.excerpt) return obj.excerpt;
  if (typeof obj.kind === "string" && obj.kind) return obj.kind;
  if (typeof obj.error === "string" && obj.error) return obj.error;
  return undefined;
}

/** "Actor" the event came from — drives icon + side-panel routing. */
export type Actor = "openclaw" | "synap" | "hermes";

export function actorFor(name: EventName): Actor {
  if (name.startsWith("openclaw:")) return "openclaw";
  if (name.startsWith("synap:")) return "synap";
  return "hermes";
}
