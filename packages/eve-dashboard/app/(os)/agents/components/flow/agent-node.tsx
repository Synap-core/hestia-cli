"use client";

/**
 * `AgentNode` — single node in the Flow view (OpenClaw / Synap / Hermes).
 *
 * Renders the actor's brand-color glass icon + a name + a real-time
 * heartbeat dot. Click to open the side panel for that node.
 *
 * Material: same `.glass-icon` recipe used on the Home grid + dock so
 * the agentic triangle reads as "your apps" rather than "engineering
 * diagram".
 */

import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
  Paperclip, Brain, Wrench,
  type LucideIcon,
} from "lucide-react";
import type { Actor } from "../../lib/event-types";

const ACTOR_GLYPH: Record<Actor, LucideIcon> = {
  openclaw: Paperclip,
  synap:    Brain,
  hermes:   Wrench,
};

const ACTOR_GRADIENT: Record<Actor, string> = {
  openclaw: "linear-gradient(180deg, #A78BFA 0%, #7C3AED 100%)",
  synap:    "linear-gradient(180deg, #6EE7B7 0%, #10B981 100%)",
  hermes:   "linear-gradient(180deg, #FBBF24 0%, #D97706 100%)",
};

const ACTOR_LABEL: Record<Actor, string> = {
  openclaw: "OpenClaw",
  synap:    "Synap",
  hermes:   "Hermes",
};

const ACTOR_ROLE: Record<Actor, string> = {
  openclaw: "ingress",
  synap:    "brain",
  hermes:   "execution",
};

export interface AgentNodeData extends Record<string, unknown> {
  actor: Actor;
  /** Recent activity counter — drives the heartbeat dot pulsing. */
  recentEvents: number;
  /** Last-event timestamp, used for the "X ago" caption. */
  lastEventAt?: string;
  /** True when the node has hard errors (e.g. hermes:task:failed). */
  hasError?: boolean;
}

export function AgentNode({ data, selected }: NodeProps) {
  const d = data as AgentNodeData;
  const Glyph = ACTOR_GLYPH[d.actor];

  return (
    <div
      className={
        "flex flex-col items-center gap-2 transition-transform duration-200 " +
        (selected ? "scale-[1.02]" : "")
      }
    >
      <Handle
        type="target"
        position={Position.Left}
        style={{ background: "transparent", border: "none" }}
      />
      <Handle
        type="source"
        position={Position.Right}
        style={{ background: "transparent", border: "none" }}
      />
      <div
        className="
          glass-icon relative
          flex h-[88px] w-[88px] items-center justify-center
        "
        style={{ background: ACTOR_GRADIENT[d.actor] }}
      >
        <Glyph
          className="h-10 w-10 text-white"
          strokeWidth={1.8}
          aria-hidden
        />
        {/* Heartbeat dot — pulses when recent activity is high. */}
        <span
          className="
            absolute -right-1 -top-1
            inline-flex h-3 w-3 items-center justify-center
          "
          aria-hidden
        >
          {d.recentEvents > 0 && !d.hasError && (
            <span className="absolute inline-flex h-full w-full rounded-full bg-success opacity-60 animate-ping" />
          )}
          <span
            className={
              "relative inline-flex h-2 w-2 rounded-full " +
              (d.hasError
                ? "bg-danger"
                : d.recentEvents > 0
                  ? "bg-success"
                  : "bg-foreground/30")
            }
          />
        </span>
      </div>
      <div className="flex flex-col items-center gap-0.5">
        <span className="text-[13px] font-medium text-foreground">
          {ACTOR_LABEL[d.actor]}
        </span>
        <span className="text-[10.5px] uppercase tracking-[0.06em] text-foreground/45">
          {ACTOR_ROLE[d.actor]}
        </span>
      </div>
    </div>
  );
}
