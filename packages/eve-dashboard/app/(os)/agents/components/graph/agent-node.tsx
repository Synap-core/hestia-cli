"use client";

/**
 * `AgentNode` — React Flow custom HTML node for the Agents graph.
 *
 * Renders the same visionOS `.glass-icon` recipe Eve uses on Home (1px
 * white inner ring + top-edge specular, no drop shadows). React Flow's
 * default node chrome is fully suppressed via the `agents-flow` CSS
 * scope so the visual is purely the icon + label.
 *
 * Selection state — the active ring is a CSS box-shadow with the agent's
 * brand accent. Because the ring is on the same DOM element as the
 * glass-icon, alignment is pixel-perfect; no SVG rect math required.
 *
 * Status — `active` adds a subtle accent glow, `error` switches to the
 * danger color. `idle` is the default rest state.
 */

import { memo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { LucideIcon } from "lucide-react";
import type { AgentLiveStatus, AgentMeta } from "../../lib/agent-registry";

// Index signature satisfies React Flow v12's `Record<string, unknown>`
// constraint on node data while keeping the named fields type-safe.
export interface AgentNodeData extends Record<string, unknown> {
  agent: AgentMeta;
  size: number;
  accent: string;
  background: string;
  glyph: LucideIcon;
  status: AgentLiveStatus;
  isSelected: boolean;
}

export type AgentRFNode = Node<AgentNodeData, "agent">;

function AgentNodeComponent({ data }: NodeProps<AgentRFNode>) {
  const { agent, size, accent, background, glyph: Glyph, status, isSelected } = data;

  const isBrain = agent.role === "brain";
  const isSub = !!agent.parentId;
  const radius = isBrain ? 18 : isSub ? 10 : 14;
  const iconSize = isBrain ? size * 0.5 : isSub ? size * 0.5 : size * 0.5;

  // Ring color logic. Selection wins over status; error wins over active.
  let ringColor: string | null = null;
  let ringOpacity = 0;
  if (isSelected) {
    ringColor = accent;
    ringOpacity = 0.95;
  } else if (status === "error") {
    ringColor = "var(--colors-danger)";
    ringOpacity = 0.85;
  } else if (status === "active") {
    ringColor = accent;
    ringOpacity = 0.55;
  }

  return (
    <div
      className="agent-node group relative"
      data-status={status}
      data-selected={isSelected || undefined}
      style={{
        // Width/height of the bounding box; the icon centers inside.
        width: size,
      }}
    >
      {/* React Flow needs at least one Handle on each side for edges to
          attach correctly. We hide them visually but keep them in the DOM. */}
      <Handle type="target" position={Position.Top} className="agent-node-handle" />
      <Handle type="source" position={Position.Bottom} className="agent-node-handle" />
      <Handle type="target" position={Position.Left} className="agent-node-handle" />
      <Handle type="source" position={Position.Right} className="agent-node-handle" />

      <div
        className="glass-icon mx-auto flex items-center justify-center"
        style={{
          width: size,
          height: size,
          borderRadius: radius,
          background,
          // Selection / status ring: a single box-shadow on the SAME
          // element as the icon, so it tracks the silhouette exactly.
          // Inner shadow (white inset) is the .glass-icon's own ring;
          // outer shadow is our state ring.
          boxShadow: ringColor
            ? `0 0 0 2px rgba(0,0,0,0.55), 0 0 0 4px ${ringColor}, 0 0 18px ${ringColor}66`
            : undefined,
          // Subtle scale on selection so the user sees the click land,
          // without the bounding box moving (React Flow handles that via
          // its CSS already on .react-flow__node-selected — we override).
          transform: isSelected ? "scale(1.04)" : undefined,
          transition: "transform 180ms ease-out, box-shadow 180ms ease-out",
        }}
      >
        <Glyph
          className="text-white"
          width={iconSize}
          height={iconSize}
          strokeWidth={isBrain ? 1.6 : 1.8}
          aria-hidden
        />
      </div>

      {/* Label — only for primaries and brain. Subagents get a tiny
          label too but smaller, on hover only (CSS-only). */}
      {!isSub ? (
        <div
          className="
            mt-2 text-center text-foreground select-none
            text-[12.5px] font-medium leading-tight
          "
        >
          {agent.label}
          {status !== "idle" && (
            <span
              className={
                "block text-[10px] uppercase tracking-[0.06em] " +
                (status === "error" ? "text-danger" : "text-success")
              }
            >
              {status}
            </span>
          )}
        </div>
      ) : (
        <div
          className="
            mt-1.5 text-center text-foreground/65 select-none
            text-[10.5px] font-medium leading-tight
            transition-opacity opacity-0 group-hover:opacity-100
            data-[selected=true]:opacity-100
          "
          data-selected={isSelected || undefined}
        >
          {agent.label}
        </div>
      )}
    </div>
  );
}

export const AgentNode = memo(AgentNodeComponent);
