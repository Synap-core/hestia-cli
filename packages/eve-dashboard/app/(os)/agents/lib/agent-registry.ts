/**
 * Agent registry — single source of truth for the Agents page topology.
 *
 * Replaces the bespoke `ACTOR_*` maps that had drifted across five files
 * (`agent-node.tsx`, `flow-view.tsx`, `timeline-view.tsx`, `node-panel.tsx`,
 * `connect-channels-modal.tsx`). Brand colors are NOT defined here — they
 * live in `app/(os)/lib/brand-colors.ts` so the Agents page, the Home dock,
 * and the Marketplace all read from one source.
 *
 * What this file owns:
 *   • Topology: which agents exist, their roles, who's a subagent of whom.
 *   • Layout slots: deterministic angular position around Synap (radial
 *     graph never drifts on reload — Hermes is always at 3 o'clock).
 *   • Lane mapping: given an event name, which agent ↔ agent edge should
 *     pulse.
 *   • Status derivation: from a stream of events, computed status snapshots.
 *
 * Adding a new agent: append an entry, set a `parentId` if it's a sub-
 * agent, pick a role. The graph picks it up automatically — no layout
 * code change needed. Brand color reuses an existing slug from
 * `brand-colors.ts`, or fallback hashing kicks in.
 *
 * See: synap-team-docs/content/team/platform/eve-agents-design.mdx §M2
 */

import type { LucideIcon } from "lucide-react";
import {
  Brain, Paperclip, Wrench, Sparkles, Code2, Bot, Globe, Cog,
} from "lucide-react";
import { brandColorFor, type BrandColor } from "../../lib/brand-colors";
import type { EventName } from "./event-types";

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Stable agent identifiers. The id format `<root>` for primaries,
 * `<root>.<sub>` for subagents lets the registry derive parentId
 * automatically and keeps lookups cheap (no separate hash).
 */
export type AgentId =
  | "synap"
  | "openclaw"
  | "hermes"
  // Synap personas (intelligence-hub) — substrate is Synap, identity is the persona.
  | "synap.orchestrator"
  | "synap.coder"
  | "synap.eve"
  // Hermes workers — specialized executors with their own event vocabulary.
  | "hermes.scrape"
  | "hermes.embed";

/**
 * Topological role. Drives angular slot assignment in the radial layout
 * AND informs the brain/ingress/execution narrative on the side panel.
 */
export type AgentRole =
  | "brain"        // Synap — always center
  | "ingress"      // Receives external signal (OpenClaw)
  | "execution"    // Runs work (Hermes)
  | "persona"      // On-demand expert (Coder, Eve)
  | "worker"       // Subagent specialised executor (Hermes.scrape)
  | "custom";      // Future user-defined agents

export interface AgentMeta {
  id: AgentId;
  /** Set when this is a subagent. Drives outer-arc placement on hover. */
  parentId?: AgentId;
  label: string;
  /** Single-line "what does it do" — shown on side panel + hover tooltip. */
  description: string;
  role: AgentRole;
  /** Slug to look up in brand-colors.ts (Lucide glyph + 2-stop gradient). */
  brandSlug: string;
  /** Lucide icon override when brandSlug doesn't have one set. */
  glyph: LucideIcon;
}

// ─── Registry ────────────────────────────────────────────────────────────────

const AGENTS: readonly AgentMeta[] = [
  // ── Center ─────────────────────────────────────────────────────────────────
  {
    id: "synap",
    label: "Synap",
    description:
      "Brain. Ingests every signal, decides what to remember, what to act on, and routes replies + tasks across your fleet.",
    role: "brain",
    brandSlug: "synap",
    glyph: Brain,
  },

  // ── Inner ring — primary agents ────────────────────────────────────────────
  {
    id: "openclaw",
    label: "OpenClaw",
    description:
      "Ingress. Listens on every messaging channel you've connected and forwards messages into the Synap brain.",
    role: "ingress",
    brandSlug: "openclaw",
    glyph: Paperclip,
  },
  {
    id: "hermes",
    label: "Hermes",
    description:
      "Execution. Runs the tasks Synap dispatches — agent runs, tool calls, automations, scheduled work.",
    role: "execution",
    brandSlug: "hermes",
    glyph: Wrench,
  },

  // ── Inner ring — Synap personas (substrate is Synap; surfaced as primary
  //    so they're addressable from the graph). They DO appear under Synap
  //    in the panel hierarchy, but they get their own slot in the ring
  //    because they speak directly to channels and act as a 1st-class agent
  //    to the user.
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: "synap.orchestrator",
    parentId: "synap",
    label: "Orchestrator",
    description:
      "Co-founder agent. Full-tool access, owns multi-step plans and delegation between personas.",
    role: "persona",
    brandSlug: "synap",
    glyph: Sparkles,
  },
  {
    id: "synap.coder",
    parentId: "synap",
    label: "Coder",
    description:
      "Domain expert for code work. Branch-only, dispatched by the Orchestrator for engineering tasks.",
    role: "persona",
    brandSlug: "dev-agent",
    glyph: Code2,
  },
  {
    id: "synap.eve",
    parentId: "synap",
    label: "Eve",
    description:
      "Local OS agent. Lives in your Eve dashboard; orchestrates components, deploys, lifecycle.",
    role: "persona",
    brandSlug: "agents",
    glyph: Bot,
  },

  // ── Hermes workers — fan out behind Hermes on hover ────────────────────────
  {
    id: "hermes.scrape",
    parentId: "hermes",
    label: "Scrape",
    description: "Worker. Runs scheduled scraping jobs against external sources.",
    role: "worker",
    brandSlug: "rsshub",
    glyph: Globe,
  },
  {
    id: "hermes.embed",
    parentId: "hermes",
    label: "Embed",
    description: "Worker. Embeds content into vector store for retrieval.",
    role: "worker",
    brandSlug: "ollama",
    glyph: Cog,
  },
];

const AGENT_BY_ID = new Map<AgentId, AgentMeta>(
  AGENTS.map((a) => [a.id, a]),
);

// ─── Layout slots ────────────────────────────────────────────────────────────

/**
 * Angular slot in degrees, measured clockwise from 12 o'clock (top).
 *
 * Convention:
 *   - Synap is center (no slot — special case).
 *   - 9 o'clock (270°): ingress (data flows in from the left)
 *   - 3 o'clock (90°): execution (work flows out to the right)
 *   - 6 o'clock (180°): personas (available on demand from below)
 *   - 12 o'clock (0°) reserved for the future "input" agent (e.g. capture)
 *
 * Multiple agents in the same role are spread evenly within a 60° arc
 * centered on their canonical slot.
 *
 * Subagents arc behind their parent in a 90° fan, drawn only when their
 * parent is hovered/selected.
 */
const ROLE_CANONICAL_SLOT: Record<AgentRole, number> = {
  brain:     0,    // unused — Synap is center
  ingress:   270,  // 9 o'clock
  execution: 90,   // 3 o'clock
  persona:   180,  // 6 o'clock
  worker:    0,    // unused — workers anchor to parent
  custom:    45,   // 1:30 — future expansion slot, between 12 and 3
};

const ROLE_ARC_SPAN_DEG: Record<AgentRole, number> = {
  brain:     0,
  ingress:   60,
  execution: 60,
  persona:   90,    // wider since this is where new personas land
  worker:    0,
  custom:    60,
};

/** Cartesian point on the inner ring, given a slot in degrees. */
export interface Point { x: number; y: number; }

/**
 * Compute the slot of every agent in degrees [0, 360).
 *
 * Pure derivation from the registry; deterministic across reloads.
 * Subagents return their parent's slot (callers fan them out separately).
 */
export function computeSlots(): Record<AgentId, number> {
  const slots = {} as Record<AgentId, number>;

  // Group primaries by role to compute even distribution within a role's arc.
  const primariesByRole = new Map<AgentRole, AgentMeta[]>();
  for (const agent of AGENTS) {
    if (agent.role === "brain") {
      slots[agent.id] = 0;
      continue;
    }
    if (agent.parentId) continue; // subagent — handled below
    const list = primariesByRole.get(agent.role) ?? [];
    list.push(agent);
    primariesByRole.set(agent.role, list);
  }

  for (const [role, list] of primariesByRole) {
    const center = ROLE_CANONICAL_SLOT[role];
    const span = ROLE_ARC_SPAN_DEG[role];
    if (list.length === 1) {
      slots[list[0].id] = center;
    } else {
      // Even distribution within the arc: positions = -span/2, ..., +span/2.
      const step = span / (list.length - 1);
      list.forEach((agent, i) => {
        const offset = -span / 2 + step * i;
        slots[agent.id] = (center + offset + 360) % 360;
      });
    }
  }

  // Subagents: copy parent's slot (callers fan them out radially behind).
  for (const agent of AGENTS) {
    if (agent.parentId && !(agent.id in slots)) {
      slots[agent.id] = slots[agent.parentId] ?? 0;
    }
  }

  return slots;
}

/**
 * Convert a slot in degrees to a unit point on a circle of given radius
 * centered at the origin. y is INVERTED (SVG convention: y grows down,
 * so 12 o'clock means y = -1).
 */
export function slotToPoint(slotDeg: number, radius: number): Point {
  const rad = ((slotDeg - 90) * Math.PI) / 180; // -90° so 0° points up
  return {
    x: Math.cos(rad) * radius,
    y: Math.sin(rad) * radius,
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function getAgent(id: AgentId): AgentMeta | undefined {
  return AGENT_BY_ID.get(id);
}

export function allAgents(): readonly AgentMeta[] {
  return AGENTS;
}

export function primaryAgents(): readonly AgentMeta[] {
  return AGENTS.filter((a) => a.role !== "brain" && !a.parentId);
}

export function subagentsOf(parentId: AgentId): readonly AgentMeta[] {
  return AGENTS.filter((a) => a.parentId === parentId);
}

/** Brand color resolved from the central registry. */
export function brandFor(agent: AgentMeta): BrandColor {
  return brandColorFor(agent.brandSlug);
}

// ─── Lane mapping (event → which edge pulses) ────────────────────────────────

/** A directed edge between two agents. */
export interface Lane {
  from: AgentId;
  to: AgentId;
}

/**
 * Map an event name to the lane that should animate.
 *
 * The taxonomy stays loose on purpose — events from new agents that
 * don't match a hand-coded rule fall back to "<actor> ↔ Synap" so the
 * graph stays informative even before we add bespoke lane mappings.
 *
 * Returns `null` for events that shouldn't animate any edge.
 */
export function laneForEvent(name: EventName): Lane | null {
  switch (name) {
    case "openclaw:message:received":
      return { from: "openclaw", to: "synap" };
    case "synap:reply:routed":
      return { from: "synap", to: "openclaw" };
    case "hermes:task:queued":
    case "hermes:task:started":
      return { from: "synap", to: "hermes" };
    case "hermes:task:completed":
    case "hermes:task:failed":
      return { from: "hermes", to: "synap" };
    default:
      return null;
  }
}

/**
 * Resolve the agent that originated an event. More flexible than
 * `actorFor` from event-types.ts because it supports subagent ids
 * (event names like `synap.coder:dispatch:run` map to that subagent).
 *
 * Falls back to the root actor when no specific subagent matches.
 */
export function originatorOfEvent(name: string): AgentId {
  // Try exact-match `<id>:` prefix scan, longest first so subagent ids win.
  const candidates = AGENTS.map((a) => a.id).sort(
    (a, b) => b.length - a.length,
  );
  for (const id of candidates) {
    if (name.startsWith(`${id}:`)) return id;
  }
  // Fallback: first segment maps to a primary actor.
  const first = name.split(":")[0];
  if (AGENT_BY_ID.has(first as AgentId)) return first as AgentId;
  return "synap";
}

// ─── Status derivation ───────────────────────────────────────────────────────

export type AgentLiveStatus = "idle" | "active" | "error";

export interface AgentStatusSnapshot {
  status: AgentLiveStatus;
  /** Number of events seen in the last 60s. */
  recent60s: number;
  /** Last event the agent emitted (any kind). */
  lastEventAt?: string;
  /** Last failure event timestamp, if within the active error window. */
  lastErrorAt?: string;
}

/** Window during which a single failure is treated as a "current" error. */
const ERROR_WINDOW_MS = 5 * 60 * 1000;

/**
 * Snapshot for ALL registered agents. Agents with no events render as
 * idle. Failures within the window override active.
 */
export function deriveAgentStatuses(
  events: ReadonlyArray<{ name: string; at: string }>,
): Record<AgentId, AgentStatusSnapshot> {
  const now = Date.now();
  const out = {} as Record<AgentId, AgentStatusSnapshot>;
  for (const agent of AGENTS) {
    out[agent.id] = { status: "idle", recent60s: 0 };
  }

  for (const evt of events) {
    const id = originatorOfEvent(evt.name);
    const ts = Date.parse(evt.at);
    if (!Number.isFinite(ts)) continue;

    const snap = out[id];
    if (!snap) continue;
    if (!snap.lastEventAt || ts > Date.parse(snap.lastEventAt)) {
      snap.lastEventAt = evt.at;
    }
    if (now - ts < 60_000) snap.recent60s += 1;
    if (evt.name.endsWith(":failed") && now - ts < ERROR_WINDOW_MS) {
      if (!snap.lastErrorAt || ts > Date.parse(snap.lastErrorAt)) {
        snap.lastErrorAt = evt.at;
      }
    }
  }

  for (const id of Object.keys(out) as AgentId[]) {
    const snap = out[id];
    if (snap.lastErrorAt) snap.status = "error";
    else if (snap.recent60s > 0) snap.status = "active";
    else snap.status = "idle";
  }

  return out;
}
