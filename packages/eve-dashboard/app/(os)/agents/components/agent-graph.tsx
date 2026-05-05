"use client";

/**
 * `AgentGraph` — agent topology rendered with React Flow + dagre.
 *
 * Layout: directed left-to-right via dagre (the same engine the studio
 * data-structure view uses). Nodes never overlap by construction; new
 * agents from the registry slot in automatically. Synap sits in the
 * middle rank as the only shared sink/source.
 *
 *   [channels] → OpenClaw ─┐
 *                          ├→  Synap → Hermes → {scrape, embed}
 *               Personas ──┘
 *
 * Interaction:
 *   • Drag the canvas to pan
 *   • Scroll to zoom
 *   • Drag a node to reposition (changes are local, not persisted)
 *   • Click a node → side panel
 *   • Controls (bottom-left): zoom in/out + fit-view
 *
 * Visual: custom HTML nodes via `AgentNode` carry the `.glass-icon`
 * recipe (1px white inner ring + top-edge specular). Selection ring is
 * a CSS box-shadow on the icon — pixel-perfect alignment.
 *
 * See: synap-team-docs/content/team/platform/eve-agents-design.mdx
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  type Edge as RFEdge,
  type NodeTypes,
  type EdgeTypes,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  brandFor, getAgent, laneForEvent,
  type AgentId, type AgentStatusSnapshot,
} from "../lib/agent-registry";
import { fallbackBrandColor } from "../../lib/brand-colors";
import { computeDagreLayout } from "../lib/dagre-layout";
import type { AgentEvent } from "../lib/event-types";
import type { UnifiedChannel } from "../lib/channel-types";
import { AgentNode, type AgentRFNode } from "./graph/agent-node";

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
  // The dagre computation is pure — same input always returns same
  // output. Memoise once; if we add server-driven runtime agents later
  // this re-runs when the registry changes.
  const layout = useMemo(() => computeDagreLayout(), []);

  // ── Build nodes ────────────────────────────────────────────────────────────
  const nodes = useMemo<AgentRFNode[]>(() => {
    return layout.nodes.map((laid) => {
      const agent = getAgent(laid.id);
      if (!agent) {
        // Should never happen — the layout is built from the registry.
        // If the registry mutates between layout and render, fall back
        // to a placeholder so we don't crash.
        return {
          id: laid.id,
          type: "agent",
          position: { x: laid.x - laid.size / 2, y: laid.y - laid.size / 2 },
          data: {
            agent: {
              id: laid.id,
              label: laid.id,
              description: "",
              role: "custom",
              brandSlug: laid.id,
              glyph: () => null as never,
            } as never,
            size: laid.size,
            accent: "#888",
            background: "#444",
            glyph: (() => null) as never,
            status: "idle",
            isSelected: false,
          },
          draggable: true,
          selectable: true,
        };
      }
      const brand = brandFor(agent);
      const status = agentStatuses[agent.id]?.status ?? "idle";
      return {
        id: agent.id,
        type: "agent",
        position: {
          x: laid.x - laid.size / 2,
          y: laid.y - laid.size / 2,
        },
        data: {
          agent,
          size: laid.size,
          accent: brand.accent,
          background: brand.bg,
          glyph: agent.glyph,
          status,
          isSelected: selectedAgent === agent.id,
        },
        draggable: true,
        selectable: true,
        focusable: true,
      };
    });
  }, [layout, agentStatuses, selectedAgent]);

  // ── Build edges ────────────────────────────────────────────────────────────
  const edges = useMemo<RFEdge[]>(() => {
    return layout.edges.map((e) => {
      const targetAgent = getAgent(e.target);
      const sourceAgent = getAgent(e.source);
      const brand = targetAgent
        ? brandFor(targetAgent)
        : sourceAgent
          ? brandFor(sourceAgent)
          : fallbackBrandColor(e.target);

      const isHot =
        highlightedLane === laneKey(e.source, e.target) ||
        highlightedLane === laneKey(e.target, e.source);
      const isLive = hasRecentActivity(events, e.source, e.target);

      return {
        id: `${e.source}__${e.target}`,
        source: e.source,
        target: e.target,
        animated: isHot || isLive,
        style: {
          stroke: isHot
            ? brand.accent
            : isLive
              ? `${brand.accent}aa`
              : "rgba(255,255,255,0.16)",
          strokeWidth: isHot ? 2.4 : isLive ? 1.6 : 1,
          opacity: isHot ? 1 : isLive ? 0.85 : 0.5,
          transition: "stroke 220ms ease-out, opacity 220ms ease-out",
        },
      };
    });
  }, [layout.edges, events, highlightedLane]);

  return (
    <div className="absolute inset-0">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable
        zoomOnScroll
        zoomOnDoubleClick
        panOnScroll={false}
        panOnDrag
        minZoom={0.4}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
        onPaneClick={() => onSelectAgent(null)}
        onNodeClick={(_e, node) => {
          const id = node.id as AgentId;
          onSelectAgent(selectedAgent === id ? null : id);
        }}
        defaultViewport={{ x: 0, y: 0, zoom: 0.95 }}
        fitView
        fitViewOptions={{ padding: 0.22, minZoom: 0.55, maxZoom: 1.1 }}
        className="agents-flow"
      >
        <Background color="rgba(255,255,255,0.04)" gap={28} size={1} />
        <Controls
          position="bottom-left"
          showInteractive={false}
          showFitView
          showZoom
          className="!bottom-3 !left-3"
        />
      </ReactFlow>
      <ResizeRefitter />
    </div>
  );
}

// Re-fit when the container resizes — without it, the graph stays
// pinned at its last fit and toggling compact/timeline mode (or
// resizing the window) leaves nodes off-canvas.
function ResizeRefitter() {
  const { fitView } = useReactFlow();
  const lastSizeRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });

  const refit = useCallback(() => {
    fitView({ padding: 0.22, duration: 200 });
  }, [fitView]);

  useEffect(() => {
    const t = window.setTimeout(refit, 50);
    return () => window.clearTimeout(t);
  }, [refit]);

  useEffect(() => {
    const onResize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      if (
        Math.abs(w - lastSizeRef.current.w) > 20 ||
        Math.abs(h - lastSizeRef.current.h) > 20
      ) {
        lastSizeRef.current = { w, h };
        refit();
      }
    };
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [refit]);

  return null;
}

/**
 * Heuristic: emit `animated: true` on edges adjacent to an agent that
 * has fired at least one event in the last 20s. Cheap; runs on every
 * render but events array is at most 200 entries.
 *
 * Both directions count — an edge from A→B lights up when EITHER A or
 * B was an originator OR a target in a recent lane.
 */
function hasRecentActivity(
  events: AgentEvent[],
  source: AgentId,
  target: AgentId,
): boolean {
  const cutoff = Date.now() - 20_000;
  for (const evt of events) {
    const lane = laneForEvent(evt.name as never);
    if (!lane) continue;
    const hits =
      (lane.from === source && lane.to === target) ||
      (lane.from === target && lane.to === source);
    if (!hits) continue;
    const ts = Date.parse(evt.at);
    if (Number.isFinite(ts) && ts >= cutoff) return true;
  }
  return false;
}
