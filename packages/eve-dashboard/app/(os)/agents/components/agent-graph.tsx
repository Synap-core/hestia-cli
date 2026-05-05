"use client";

/**
 * `AgentGraph` — Synap-centered radial topology, pure SVG.
 *
 * Synap sits at center; primary agents arc on the inner ring (slots from
 * `computeSlots()` — adding a registry entry never needs a layout patch).
 * Subagents fan out on a 90° arc on the far side of the parent when the
 * parent is hovered or selected. Pulses ride edges via `<animateMotion>`.
 *
 * Visual recipe: visionOS material via `.glass-icon` (1px white inner ring
 * + top-edge specular). No drop shadows. Pane host provides containment.
 *
 * See: synap-team-docs/content/team/platform/eve-agents-design.mdx
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  allAgents, brandFor, computeSlots, getAgent, laneForEvent,
  primaryAgents, slotToPoint, subagentsOf,
  type AgentId, type AgentMeta, type AgentStatusSnapshot, type Point,
} from "../lib/agent-registry";
import { fallbackBrandColor } from "../../lib/brand-colors";
import type { AgentEvent } from "../lib/event-types";
import type { UnifiedChannel } from "../lib/channel-types";

const VIEW_W = 720;
const VIEW_H = 380;
const CENTER: Point = { x: VIEW_W / 2, y: VIEW_H / 2 };
const INNER_RADIUS = 150;
const SUB_FAN_RADIUS = 100;
const SUB_FAN_SPAN_DEG = 90;
const NODE_BRAIN = 88;
const NODE_PRIMARY = 64;
const NODE_SUB = 40;
const PULSE_MS = 900;
const PULSE_CAP = 8;
const HIGHLIGHT_DECAY_MS = 1500;

export interface AgentGraphProps {
  events: AgentEvent[];
  agentStatuses: Record<AgentId, AgentStatusSnapshot>;
  selectedAgent: AgentId | null;
  onSelectAgent: (id: AgentId | null) => void;
  channels: UnifiedChannel[];
  highlightedLane?: string | null;
}

const laneKey = (a: AgentId, b: AgentId) => `${a}->${b}`;

function nodeSizeFor(agent: AgentMeta): number {
  if (agent.role === "brain") return NODE_BRAIN;
  return agent.parentId ? NODE_SUB : NODE_PRIMARY;
}

interface Pulse { id: number; from: AgentId; to: AgentId; color: string; }

export function AgentGraph({
  events, agentStatuses, selectedAgent, onSelectAgent, channels, highlightedLane,
}: AgentGraphProps) {
  const slots = useMemo(() => computeSlots(), []);
  const primaries = useMemo(() => primaryAgents(), []);
  const allList = useMemo(() => allAgents(), []);
  const [hoveredParent, setHoveredParent] = useState<AgentId | null>(null);

  // Layout: pure derivation. Subagents arc outward from their parent in a
  // 90° fan, away from the center — visibility is opacity-driven so the
  // layout stays stable for fade transitions.
  const positions = useMemo(() => {
    const out: Record<AgentId, Point> = {} as Record<AgentId, Point>;
    out["synap"] = CENTER;
    for (const agent of primaries) {
      const p = slotToPoint(slots[agent.id] ?? 0, INNER_RADIUS);
      out[agent.id] = { x: CENTER.x + p.x, y: CENTER.y + p.y };
    }
    for (const agent of allList) {
      if (!agent.parentId) continue;
      const parent = out[agent.parentId];
      if (!parent) continue;
      const siblings = subagentsOf(agent.parentId);
      const idx = siblings.findIndex((s) => s.id === agent.id);
      const count = siblings.length;
      const baseDeg = (Math.atan2(parent.y - CENTER.y, parent.x - CENTER.x) * 180) / Math.PI;
      const offset = count === 1 ? 0
        : -SUB_FAN_SPAN_DEG / 2 + (SUB_FAN_SPAN_DEG / (count - 1)) * idx;
      const ang = ((baseDeg + offset) * Math.PI) / 180;
      out[agent.id] = {
        x: parent.x + Math.cos(ang) * SUB_FAN_RADIUS,
        y: parent.y + Math.sin(ang) * SUB_FAN_RADIUS,
      };
    }
    return out;
  }, [allList, primaries, slots]);

  // Pulse stream — mirror lastSeenRef pattern from flow-view so re-renders
  // never replay old events. Cap concurrent pulses; drop oldest beyond cap.
  const lastSeenRef = useRef<string | null>(null);
  const pulseSeq = useRef(0);
  const pulseTimers = useRef<Set<number>>(new Set());
  const [pulses, setPulses] = useState<Pulse[]>([]);

  useEffect(() => {
    if (events.length === 0) return;
    const newest = events[0];
    if (newest.id === lastSeenRef.current) return;
    const fresh: AgentEvent[] = [];
    for (const evt of events) {
      if (evt.id === lastSeenRef.current) break;
      fresh.unshift(evt);
    }
    lastSeenRef.current = newest.id;
    for (const evt of fresh) {
      const lane = laneForEvent(evt.name);
      if (!lane) continue;
      const fromAgent = getAgent(lane.from);
      if (!fromAgent) continue;
      const color = brandFor(fromAgent).accent;
      const id = ++pulseSeq.current;
      setPulses((prev) => {
        const next = [...prev, { id, from: lane.from, to: lane.to, color }];
        return next.length > PULSE_CAP ? next.slice(next.length - PULSE_CAP) : next;
      });
      const timer = window.setTimeout(() => {
        pulseTimers.current.delete(timer);
        setPulses((prev) => prev.filter((p) => p.id !== id));
      }, PULSE_MS + 50);
      pulseTimers.current.add(timer);
    }
  }, [events]);

  // Clear any pending pulse-removal timers on unmount so we don't call
  // setPulses on a torn-down component (React 19 still warns).
  useEffect(() => {
    const timers = pulseTimers.current;
    return () => {
      for (const t of timers) window.clearTimeout(t);
      timers.clear();
    };
  }, []);

  // Ephemeral highlight (activity feed → graph). Decays after 1.5s.
  const [decayingHighlight, setDecayingHighlight] = useState<string | null>(null);
  useEffect(() => {
    if (!highlightedLane) { setDecayingHighlight(null); return; }
    setDecayingHighlight(highlightedLane);
    const t = window.setTimeout(() => setDecayingHighlight(null), HIGHLIGHT_DECAY_MS);
    return () => window.clearTimeout(t);
  }, [highlightedLane]);

  const synapEdges = useMemo(() => primaries.map((agent) => {
    const p = positions[agent.id];
    return {
      id: `synap--${agent.id}`,
      from: "synap" as AgentId,
      to: agent.id,
      d: `M ${CENTER.x} ${CENTER.y} L ${p.x} ${p.y}`,
      accent: brandFor(agent).accent,
    };
  }), [primaries, positions]);

  // A2A edges — curved arc between any two agents that share a kind="a2a"
  // channel. Control point pushed outward from the graph center.
  const a2aEdges = useMemo(() => {
    const out: Array<{ id: string; from: AgentId; to: AgentId; d: string; accent: string; }> = [];
    const seen = new Set<string>();
    for (const ch of channels) {
      if (ch.kind !== "a2a") continue;
      const parts = ch.participants.filter((p) => p !== "synap");
      for (let i = 0; i < parts.length; i++) {
        for (let j = i + 1; j < parts.length; j++) {
          const a = parts[i], b = parts[j];
          const key = a < b ? `${a}::${b}` : `${b}::${a}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const pa = positions[a], pb = positions[b];
          if (!pa || !pb) continue;
          const mx = (pa.x + pb.x) / 2, my = (pa.y + pb.y) / 2;
          const cx = mx + (mx - CENTER.x) * 0.35;
          const cy = my + (my - CENTER.y) * 0.35;
          const fromAgent = getAgent(a);
          out.push({
            id: `a2a--${key}`, from: a, to: b,
            d: `M ${pa.x} ${pa.y} Q ${cx} ${cy} ${pb.x} ${pb.y}`,
            accent: fromAgent
              ? brandFor(fromAgent).accent
              : fallbackBrandColor(a).accent,
          });
        }
      }
    }
    return out;
  }, [channels, positions]);

  const isSubExpanded = (parentId: AgentId) =>
    hoveredParent === parentId || selectedAgent === parentId;

  return (
    <div className="relative w-full overflow-hidden rounded-stat-card">
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        width="100%"
        className="block"
        role="img"
        aria-label="Agent topology graph"
      >
        {synapEdges.map((edge) => {
          const isHighlighted =
            decayingHighlight === laneKey(edge.from, edge.to) ||
            decayingHighlight === laneKey(edge.to, edge.from);
          const isSelected = selectedAgent === edge.to || selectedAgent === edge.from;
          return (
            <path
              key={edge.id}
              d={edge.d}
              fill="none"
              stroke={isHighlighted || isSelected ? edge.accent : "currentColor"}
              strokeWidth={isHighlighted ? 1.6 : 1}
              strokeLinecap="round"
              className="text-foreground"
              style={{
                opacity: isHighlighted ? 0.85 : isSelected ? 0.45 : 0.15,
                transition: "opacity 300ms ease-out, stroke-width 300ms ease-out",
              }}
            />
          );
        })}

        {a2aEdges.map((edge) => {
          const isHighlighted =
            decayingHighlight === laneKey(edge.from, edge.to) ||
            decayingHighlight === laneKey(edge.to, edge.from);
          return (
            <path
              key={edge.id}
              d={edge.d}
              fill="none"
              stroke={isHighlighted ? edge.accent : "currentColor"}
              strokeWidth={1}
              strokeDasharray="4 3"
              strokeLinecap="round"
              className="text-foreground"
              style={{
                opacity: isHighlighted ? 0.7 : 0.12,
                transition: "opacity 300ms ease-out",
              }}
            />
          );
        })}

        {pulses.map((pulse) => {
          const fromP = positions[pulse.from], toP = positions[pulse.to];
          if (!fromP || !toP) return null;
          return (
            <PulseGlyph
              key={pulse.id}
              path={`M ${fromP.x} ${fromP.y} L ${toP.x} ${toP.y}`}
              color={pulse.color}
            />
          );
        })}

        {/* Subagent connector edges — fade with parent expansion. */}
        {allList.filter((a) => a.parentId).map((sub) => {
          const parent = positions[sub.parentId!];
          const me = positions[sub.id];
          if (!parent || !me) return null;
          const visible = isSubExpanded(sub.parentId!);
          return (
            <line
              key={`subedge--${sub.id}`}
              x1={parent.x} y1={parent.y} x2={me.x} y2={me.y}
              stroke="currentColor"
              strokeWidth={1}
              className="text-foreground"
              style={{
                opacity: visible ? 0.18 : 0,
                transition: "opacity 300ms ease-out",
                pointerEvents: "none",
              }}
            />
          );
        })}

        {allList.map((agent) => {
          const p = positions[agent.id];
          if (!p) return null;
          const isSub = Boolean(agent.parentId);
          const visible = !isSub || isSubExpanded(agent.parentId!);
          return (
            <NodeView
              key={agent.id}
              agent={agent}
              center={p}
              size={nodeSizeFor(agent)}
              status={agentStatuses[agent.id]}
              isSelected={selectedAgent === agent.id}
              visible={visible}
              onClick={() =>
                onSelectAgent(selectedAgent === agent.id ? null : agent.id)
              }
              onHoverStart={!isSub ? () => setHoveredParent(agent.id) : undefined}
              onHoverEnd={!isSub
                ? () => setHoveredParent((c) => (c === agent.id ? null : c))
                : undefined}
            />
          );
        })}
      </svg>

      <style jsx>{`
        @keyframes agent-pulse-ring {
          0%   { transform: scale(1);    opacity: 0.6; }
          70%  { transform: scale(1.18); opacity: 0;   }
          100% { transform: scale(1.18); opacity: 0;   }
        }
      `}</style>
    </div>
  );
}

interface NodeViewProps {
  agent: AgentMeta;
  center: Point;
  size: number;
  status?: AgentStatusSnapshot;
  isSelected: boolean;
  visible: boolean;
  onClick: () => void;
  onHoverStart?: () => void;
  onHoverEnd?: () => void;
}

function NodeView({
  agent, center, size, status, isSelected, visible,
  onClick, onHoverStart, onHoverEnd,
}: NodeViewProps) {
  const palette = brandFor(agent);
  const Glyph = agent.glyph;
  const half = size / 2;
  const isSub = Boolean(agent.parentId);
  const labelFontPx = isSub ? 11 : 13;
  const sublabelFontPx = 10.5;
  const labelY = center.y + half + 8 + labelFontPx;
  const sublabelY = labelY + sublabelFontPx + 2;
  const ringStatus = status?.status ?? "idle";
  const recent = status?.recent60s ?? 0;
  const recentLabel = recent > 0 ? `${recent}/min` : "idle";
  const ringRadius = half + 4;
  // Theme-aware error color: HeroUI exposes `--heroui-danger` as HSL parts
  // so dark/light flips just work. Active state uses the agent's brand accent.
  const ringColor =
    ringStatus === "error"
      ? "hsl(var(--heroui-danger))"
      : palette.accent;
  const showRing = ringStatus === "active" || ringStatus === "error";

  return (
    <g
      style={{
        opacity: visible ? 1 : 0,
        transform: isSelected ? "scale(1.05)" : "scale(1)",
        transformOrigin: `${center.x}px ${center.y}px`,
        transformBox: "fill-box",
        transition: "opacity 300ms ease-out, transform 300ms ease-out",
        cursor: "pointer",
        pointerEvents: visible ? "auto" : "none",
      }}
      onClick={onClick}
      onMouseEnter={onHoverStart}
      onMouseLeave={onHoverEnd}
      onKeyDown={(e) => {
        // SVG `<g role="button">` doesn't trigger click on Enter/Space natively.
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      role="button"
      tabIndex={visible ? 0 : -1}
      aria-label={`${agent.label} — ${agent.description}`}
    >
      {showRing && (
        <circle
          cx={center.x} cy={center.y} r={ringRadius}
          fill="none"
          stroke={ringColor}
          strokeWidth={1.5}
          opacity={ringStatus === "error" ? 0.7 : 0.45}
          style={{
            animation: ringStatus === "active"
              ? "agent-pulse-ring 1800ms ease-out infinite"
              : undefined,
            transformOrigin: `${center.x}px ${center.y}px`,
            transformBox: "fill-box",
          }}
        />
      )}
      <foreignObject
        x={center.x - half} y={center.y - half}
        width={size} height={size}
      >
        <div
          className="glass-icon flex h-full w-full items-center justify-center"
          style={{ background: palette.bg }}
        >
          <Glyph
            color="white"
            strokeWidth={2}
            size={Math.round(size * 0.42)}
            opacity={0.95}
            aria-hidden
          />
        </div>
      </foreignObject>
      <text
        x={center.x} y={labelY}
        textAnchor="middle"
        fontSize={labelFontPx}
        fontWeight={500}
        className="fill-foreground/85 select-none"
      >
        {agent.label}
      </text>
      {!isSub && (
        <text
          x={center.x} y={sublabelY}
          textAnchor="middle"
          fontSize={sublabelFontPx}
          className="fill-foreground/55 select-none"
        >
          {recentLabel}
        </text>
      )}
    </g>
  );
}

/** Single-shot SVG pulse along a path. Parent unmounts on completion. */
function PulseGlyph({ path, color }: { path: string; color: string }) {
  return (
    <g style={{ pointerEvents: "none" }}>
      <circle r={9} fill={color} opacity={0.18}>
        <animateMotion dur={`${PULSE_MS}ms`} begin="0s" fill="freeze" path={path} />
        <animate attributeName="opacity" values="0;0.35;0.35;0"
          keyTimes="0;0.1;0.85;1" dur={`${PULSE_MS}ms`} fill="freeze" />
      </circle>
      <circle r={4} fill={color} opacity={0.95}>
        <animateMotion dur={`${PULSE_MS}ms`} begin="0s" fill="freeze" path={path} />
        <animate attributeName="opacity" values="0;1;1;0"
          keyTimes="0;0.1;0.85;1" dur={`${PULSE_MS}ms`} fill="freeze" />
      </circle>
    </g>
  );
}
