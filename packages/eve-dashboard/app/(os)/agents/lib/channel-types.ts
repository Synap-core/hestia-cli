/**
 * Unified channel registry — types.
 *
 * The Agents page surfaces ALL channels through a single shape regardless
 * of where they live (OpenClaw container, Synap pod, intelligence-hub
 * A2A pipes). This module is the contract between the server endpoint
 * (`app/api/agents/channels/route.ts`) and the client (the strip + the
 * graph + the activity feed click-through).
 *
 * The shape mirrors `synap-backend/packages/database/src/schema/channels.ts`
 * intentionally — when we later expose a Hub Protocol `GET /channels/list`
 * endpoint, we can replace the local fan-out with one fetch and the
 * client code won't need to change.
 *
 * See: synap-team-docs/content/team/platform/eve-agents-design.mdx §M3
 */

import type { AgentId } from "./agent-registry";

// ─── Kind ────────────────────────────────────────────────────────────────────

export type ChannelKind =
  // External messaging — OpenClaw routes them into Synap.
  | "telegram"
  | "discord"
  | "whatsapp"
  | "signal"
  | "matrix"
  // Synap-internal — channels in the pod (ai_thread, branch, comments…).
  | "synap"
  // Agent-to-agent pipes inside the intelligence hub.
  | "a2a";

// ─── Connection status ───────────────────────────────────────────────────────

export type ChannelConnectionStatus =
  | "connected"     // Live, ready to send/receive
  | "connecting"    // Handshake / QR scan in progress
  | "needs_attention" // Token expired, scan needed, etc.
  | "disconnected"  // Not configured or explicitly disabled
  | "unknown";      // We couldn't resolve state (e.g. pod offline)

// ─── Open-link contract ──────────────────────────────────────────────────────

/**
 * Discriminated union for "where does click-back-to-channel send the user?".
 *
 * `external` — opens a URL scheme + http fallback (Telegram, Discord, WA…).
 *              Browsers without the scheme handler fall back to the http
 *              link with a copy-link affordance.
 * `synap`    — opens the Synap pod's web app at the conversation.
 * `internal` — stays inside Eve and opens an in-OS panel/route.
 */
export type ChannelOpenTarget =
  | { kind: "external"; scheme: string; httpFallback: string }
  | { kind: "synap";    href: string }
  | { kind: "internal"; href: string };

// ─── Unified channel ─────────────────────────────────────────────────────────

export interface UnifiedChannel {
  /** Stable, prefix-namespaced ID: `telegram:<botId>`, `synap:<channelId>`,
   *  `a2a:<pipeId>`. Used as React key + for highlight cross-references. */
  id: string;
  kind: ChannelKind;
  /** Display label — "Antoine — Telegram", "Personal channel", etc. */
  label: string;
  /** Sub-label rendered in `text-foreground/55`. Optional. */
  hint?: string;
  /** Agents that participate in this channel. Drives the graph A2A edges. */
  participants: AgentId[];
  connectionStatus: ChannelConnectionStatus;
  /** Best-effort last-event timestamp (ISO). May be undefined for newly
   *  configured channels that haven't seen traffic yet. */
  lastEventAt?: string;
  /** Click target. */
  openTarget: ChannelOpenTarget;
  /** Source-specific extras. Free-form; only consumers that recognize the
   *  kind read these. Server-side may set `metadata.qrDataUrl` for
   *  WhatsApp awaiting-scan, for example. */
  metadata?: Record<string, unknown>;
}

export interface ChannelRegistryResponse {
  channels: UnifiedChannel[];
  /** True when at least one source returned an error — UI surfaces a
   *  banner without throwing the whole page out. */
  partial: boolean;
  /** Per-source error map. Keys are channel kinds. */
  errors?: Partial<Record<ChannelKind, string>>;
}
