"use client";

/**
 * `AgentGraph` — Synap-centered agent topology, rendered with React Flow.
 *
 * Why React Flow (`@xyflow/react`):
 *   • Node selection / focus / panning / zoom come for free, with proper
 *     hit-testing — the previous SVG version had selection rings drawn at
 *     <rect> y-offsets that drifted from the underlying HTML glass-icon.
 *   • Edge animation via `animated: true` replaces hand-rolled
 *     `<animateMotion>` tags; pulses Just Work without timer juggling.
 *   • Custom HTML nodes (vs. <foreignObject>) means the same `.glass-icon`
 *     recipe Eve uses on Home renders pixel-identical here.
 *
 * Layout: deterministic radial. Synap at center. Primary agents on an
 * inner ring at angles derived from their role (`computeSlots`).
 * Subagents are ALWAYS visible — fanned out on an outer arc behind
 * their parent, not hover-revealed (the old behavior trapped the cursor:
 * leave parent → subs vanish → can't click them).
 *
 * Adding a new agent at runtime: append to the registry (or future
 * `query_agents` Hub Protocol call) and the layout picks it up. No
 * angular slots to hand-edit, no parent fan code to touch.
 *
 * See: synap-team-docs/content/team/platform/eve-agents-design.mdx
 */

import { useEffect, useMemo, useRef } from "react";
import {
  ReactFlow,
  Background,
  type Edge as RFEdge,
  type NodeTypes,
  type EdgeTypes,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  allAgents, brandFor, computeSlots, getAgent, laneForEvent,
  primaryAgents, slotToPoint, subagentsOf,
  type AgentId, type AgentMeta, type AgentStatusSnapshot,
} from "../lib/agent-registry";
import { fallbackBrandColor } from "../../lib/brand-colors";
import type { AgentEvent } from "../lib/event-types";
import type { UnifiedChannel } from "../lib/channel-types";
import { AgentNode, type AgentRFNode } from "./graph/agent-node";

// ─── Layout constants ────────────────────────────────────────────────────────

const VIEW_W = 880;
const VIEW_H = 460;
const CENTER = { x: VIEW_W / 2, y: VIEW_H / 2 };
const INNER_RADIUS = 200;
const SUB_FAN_RADIUS = 130;
const SUB_FAN_SPAN_DEG = 100;

// Node sizes — matching `.glass-icon` recipe.
const NODE_BRAIN = 88;
const NODE_PRIMARY = 64;
const NODE_SUB = 44;

// ─── Public API ──────────────────────────────────────────────────────────────

export interface AgentGraphProps {
  events: AgentEvent[];
  agentStatuses: Record<AgentId, AgentStatusSnapshot>;
  selectedAgent: AgentId | null;
  onSelectAgent: (id: AgentId | null) => void;
  channels: UnifiedChannel[];
  highlightedLane?: string | null;
}

export function AgentGraph(props: AgentGraphProps) {
  return (
    <ReactFlowProvider>
      <AgentGraphCanvas {...props} />
    </ReactFlowProvider>
  );
}

// ─── Canvas ──────────────────────────────────────────────────────────────────

function nodeSizeFor(agent: AgentMeta): number {
  if (agent.role === "brain") return NODE_BRAIN;
  return agent.parentId ? NODE_SUB : NODE_PRIMARY;
}

const laneKey = (a: AgentId, b: AgentId) => `${a}->${b}`;

const nodeTypes: NodeTypes = { agent: AgentNode };
const edgeTypes: EdgeTypes = {};

function AgentGraphCanvas({
  events,
  agentStatuses,
  selectedAgent,
  onSelectAgent,
  highlightedLane,
}: AgentGraphProps) {
  const slots = useMemo(() => computeSlots(), []);
  const allList = useMemo(() => allAgents(), []);
  const primaries = useMemo(() => primaryAgents(), []);

  // Pre-compute subagent angular positions for each parent. Each subagent
  // sits at a unique angle on a 100° arc behind its parent. Behind = on
  // the side AWAY from Synap, so subs never occlude the brain.
  const subAngles = useMemo<Record<AgentId, number>>(() => {
    const out: Record<string, number> = {};
    for (const parent of primaries) {
      const parentSlot = slots[parent.id];
      const subs = subagentsOf(parent.id);
      if (subs.length === 0) continue;
      // Anchor angle = parent slot (pointing from center outward).
      // Subagents fan symmetrically on either side of the anchor, in the
      // outer half-plane from the brain.
      if (subs.length === 1) {
        out[subs[0].id] = parentSlot;
      } else {
        const step = SUB_FAN_SPAN_DEG / (subs.length - 1);
        subs.forEach((sub, i) => {
          out[sub.id] =
            (parentSlot - SUB_FAN_SPAN_DEG / 2 + step * i + 360) % 360;
        });
      }
    }
    return out as Record<AgentId, number>;
  }, [primaries, slots]);

  // ── Build nodes ────────────────────────────────────────────────────────────
  const nodes = useMemo<AgentRFNode[]>(() => {
    const out: AgentRFNode[] = [];

    for (const agent of allList) {
      const size = nodeSizeFor(agent);
      const brand =
        getAgent(agent.id) ? brandFor(agent) : fallbackBrandColor(agent.id);
      const status = agentStatuses[agent.id]?.status ?? "idle";
      const isSelected = selectedAgent === agent.id;

      let position: { x: number; y: number };
      if (agent.role === "brain") {
        position = { x: CENTER.x - size / 2, y: CENTER.y - size / 2 };
      } else if (agent.parentId) {
        const angle = subAngles[agent.id] ?? slots[agent.id] ?? 0;
        // Anchor on the parent's outer ring: parent center + sub-radius
        // along the angle from CENTER (so subs sit "behind" parents).
        const parent = getAgent(agent.parentId);
        const parentSize = parent ? nodeSizeFor(parent) : NODE_PRIMARY;
        const parentPos = slotToPoint(slots[agent.parentId] ?? 0, INNER_RADIUS);
        const subPos = slotToPoint(angle, SUB_FAN_RADIUS);
        position = {
          // Parent center → add SUB_FAN_RADIUS along the angle from CENTER.
          x: CENTER.x + parentPos.x + (subPos.x - 0) * 0.7 - size / 2,
          y: CENTER.y + parentPos.y + (subPos.y - 0) * 0.7 - size / 2,
        };
        // Note: 0.7 keeps subs close enough that the parent→sub edge reads
        // as a tight cluster; pure outer-ring would push them off-canvas.
        void parentSize;
      } else {
        const p = slotToPoint(slots[agent.id] ?? 0, INNER_RADIUS);
        position = {
          x: CENTER.x + p.x - size / 2,
          y: CENTER.y + p.y - size / 2,
        };
      }

      out.push({
        id: agent.id,
        type: "agent",
        position,
        data: {
          agent,
          size,
          accent: brand.accent,
          background: brand.bg,
          glyph: agent.glyph,
          status,
          isSelected,
        },
        // React Flow built-in selection — we still drive selectedAgent
        // ourselves via onNodeClick because we want a single-select model.
        selectable: true,
        draggable: false,
        // We bypass React Flow's selection styling and use our own ring
        // (rendered inside AgentNode based on `data.isSelected`) so the
        // ring matches the glass-icon's silhouette pixel-for-pixel.
        focusable: true,
      });
    }
    return out;
  }, [allList, agentStatuses, selectedAgent, slots, subAngles]);

  // ── Build edges ────────────────────────────────────────────────────────────
  const edges = useMemo<RFEdge[]>(() => {
    const out: RFEdge[] = [];

    // Synap ↔ each primary
    for (const agent of primaries) {
      const brand = brandFor(agent);
      const key = laneKey("synap", agent.id);
      const reverseKey = laneKey(agent.id, "synap");
      const isHot =
        highlightedLane === key || highlightedLane === reverseKey;
      out.push({
        id: `synap__${agent.id}`,
        source: "synap",
        target: agent.id,
        animated: isHot || hasRecentActivity(events, agent.id),
        style: {
          stroke: isHot ? brand.accent : "rgba(255,255,255,0.18)",
          strokeWidth: isHot ? 2.2 : 1.2,
          opacity: isHot ? 1 : 0.65,
          transition: "stroke 220ms ease-out, opacity 220ms ease-out",
        },
      });
    }

    // Parent ↔ subagent
    for (const agent of allList) {
      if (!agent.parentId) continue;
      const brand = brandFor(agent);
      const key = laneKey(agent.parentId, agent.id);
      const reverseKey = laneKey(agent.id, agent.parentId);
      const isHot =
        highlightedLane === key || highlightedLane === reverseKey;
      out.push({
        id: `${agent.parentId}__${agent.id}`,
        source: agent.parentId,
        target: agent.id,
        animated: isHot,
        style: {
          stroke: isHot ? brand.accent : "rgba(255,255,255,0.10)",
          strokeWidth: 1,
          opacity: 0.5,
        },
      });
    }
    return out;
  }, [primaries, allList, events, highlightedLane]);

  return (
    <div className="absolute inset-0">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        zoomOnScroll={false}
        zoomOnDoubleClick={false}
        panOnScroll={false}
        panOnDrag={false}
        proOptions={{ hideAttribution: true }}
        onPaneClick={() => onSelectAgent(null)}
        onNodeClick={(_e, node) => {
          const id = node.id as AgentId;
          onSelectAgent(selectedAgent === id ? null : id);
        }}
        defaultViewport={{ x: 0, y: 0, zoom: 1 }}
        fitView
        fitViewOptions={{ padding: 0.18, minZoom: 0.55, maxZoom: 1.1 }}
        className="agents-flow"
      >
        <Background color="rgba(255,255,255,0.04)" gap={28} size={1} />
      </ReactFlow>
      <FitViewObserver />
    </div>
  );
}

// Re-fit when the container resizes (compact ↔ timeline toggle, window).
function FitViewObserver() {
  const { fitView } = useReactFlow();
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const t = window.setTimeout(
      () => fitView({ padding: 0.18, duration: 200 }),
      50,
    );
    return () => window.clearTimeout(t);
  }, [fitView]);
  return <div ref={ref} aria-hidden className="hidden" />;
}

// Heuristic: emit `animated: true` on synap↔agent edges when the agent
// has at least one event in the last 20s. Cheap; runs on every render
// but events array is at most 200 entries.
function hasRecentActivity(events: AgentEvent[], agentId: AgentId): boolean {
  const cutoff = Date.now() - 20_000;
  for (const evt of events) {
    const lane = laneForEvent(evt.name as never);
    if (!lane) continue;
    if (lane.from !== agentId && lane.to !== agentId) continue;
    const ts = Date.parse(evt.at);
    if (Number.isFinite(ts) && ts >= cutoff) return true;
  }
  return false;
}
