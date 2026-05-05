"use client";

/**
 * `FlowView` — n8n-style live node graph of the agentic triangle.
 *
 * Three fixed nodes laid out left → right:
 *
 *     OpenClaw  →  Synap  →  Hermes
 *      (ingress)   (brain)   (execution)
 *
 * One animated pulse-edge per direction. Each typed event maps to
 * exactly one lane:
 *
 *   openclaw:message:received → openclaw → synap
 *   synap:reply:routed        → synap → openclaw
 *   hermes:task:queued        → synap → hermes
 *   hermes:task:started       → synap → hermes (slower / dim)
 *   hermes:task:completed     → hermes → synap (success color)
 *   hermes:task:failed        → hermes → synap (error color)
 *
 * Nodes also carry an "activity counter" + "hasError" flag derived
 * from the same event stream. Click a node → open the side panel for
 * that actor.
 *
 * See: synap-team-docs/content/team/platform/eve-agents-design.mdx
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  type Node,
  type Edge,
  type EdgeTypes,
  type NodeTypes,
  type OnSelectionChangeFunc,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { AgentNode, type AgentNodeData } from "./flow/agent-node";
import { PulseEdge } from "./flow/pulse-edge";
import {
  type AgentEvent,
  type Actor,
  type EventName,
  actorFor,
} from "../lib/event-types";

const NODE_TYPES: NodeTypes = { agent: AgentNode };
const EDGE_TYPES: EdgeTypes = { pulse: PulseEdge };

// Static layout. Three columns, vertically centered. Nodes are 88×88
// inside a 100-ish-wide bounding box; spacing chosen so the edges read
// as "long enough for the pulse to feel like travel" without scrolling.
const NODE_POSITIONS: Record<Actor, { x: number; y: number }> = {
  openclaw: { x:   0, y: 80 },
  synap:    { x: 280, y: 80 },
  hermes:   { x: 560, y: 80 },
};

interface LaneState {
  pulseKey: number;
  color: string;
  isError: boolean;
}

const LANE_COLORS: Record<string, string> = {
  "openclaw->synap": "#A78BFA",   // violet (OpenClaw incoming)
  "synap->openclaw": "#34D399",   // emerald (Synap outgoing)
  "synap->hermes":   "#34D399",   // emerald (Synap dispatching)
  "hermes->synap":   "#FBBF24",   // amber (Hermes reporting back)
};

/** Translate an event name into "which lane should pulse?". */
function laneFor(name: EventName): string | null {
  switch (name) {
    case "openclaw:message:received": return "openclaw->synap";
    case "synap:reply:routed":        return "synap->openclaw";
    case "hermes:task:queued":
    case "hermes:task:started":       return "synap->hermes";
    case "hermes:task:completed":
    case "hermes:task:failed":        return "hermes->synap";
    default:                          return null;
  }
}

export interface FlowViewProps {
  events: AgentEvent[];
  /** Callback when the operator selects an actor (clicks a node). */
  onSelectActor?: (actor: Actor | null) => void;
}

const RECENT_WINDOW_MS = 4000;

export function FlowView({ events, onSelectActor }: FlowViewProps) {
  const [lanes, setLanes] = useState<Record<string, LaneState>>({});
  const [recentByActor, setRecentByActor] = useState<Record<Actor, number>>({
    openclaw: 0, synap: 0, hermes: 0,
  });
  const [hasError, setHasError] = useState<Record<Actor, boolean>>({
    openclaw: false, synap: false, hermes: false,
  });

  // Track the highest event ID we've already animated, so re-renders
  // don't replay old pulses.
  const lastSeenRef = useRef<string | null>(null);

  useEffect(() => {
    if (events.length === 0) return;
    const newest = events[0];
    if (newest.id === lastSeenRef.current) return;

    // Fire one pulse per *new* event since we last looked. Iterate in
    // reverse so the OLDEST unseen pulse is fired first.
    const fresh: AgentEvent[] = [];
    for (const evt of events) {
      if (evt.id === lastSeenRef.current) break;
      fresh.unshift(evt);
    }
    lastSeenRef.current = newest.id;

    for (const evt of fresh) {
      const lane = laneFor(evt.name);
      if (!lane) continue;
      const isError = evt.name === "hermes:task:failed";
      const color = isError ? "#F87171" : LANE_COLORS[lane] ?? "#34D399";
      setLanes(prev => ({
        ...prev,
        [lane]: {
          pulseKey: (prev[lane]?.pulseKey ?? 0) + 1,
          color,
          isError,
        },
      }));
      const actor = actorFor(evt.name);
      setRecentByActor(prev => ({ ...prev, [actor]: prev[actor] + 1 }));
      if (isError) {
        setHasError(prev => ({ ...prev, [actor]: true }));
      }
    }
  }, [events]);

  // Decay the "recent activity" counters on every event so the heartbeat
  // dot calms down when the stream goes quiet.
  useEffect(() => {
    if (recentByActor.openclaw + recentByActor.synap + recentByActor.hermes === 0) {
      return;
    }
    const t = setTimeout(() => {
      setRecentByActor(prev => ({
        openclaw: Math.max(0, prev.openclaw - 1),
        synap:    Math.max(0, prev.synap    - 1),
        hermes:   Math.max(0, prev.hermes   - 1),
      }));
      setHasError(prev => prev); // keep error state until cleared explicitly
    }, RECENT_WINDOW_MS);
    return () => clearTimeout(t);
  }, [recentByActor]);

  const nodes: Node<AgentNodeData>[] = useMemo(() => {
    return (["openclaw", "synap", "hermes"] as Actor[]).map(actor => ({
      id: actor,
      type: "agent",
      position: NODE_POSITIONS[actor],
      data: {
        actor,
        recentEvents: recentByActor[actor],
        hasError: hasError[actor],
      },
      draggable: false,
      selectable: true,
    }));
  }, [recentByActor, hasError]);

  const edges: Edge[] = useMemo(() => {
    const lane = (key: string, source: string, target: string): Edge => ({
      id: key,
      source,
      target,
      type: "pulse",
      data: lanes[key] ?? { pulseKey: 0, color: LANE_COLORS[key], isError: false },
      // ReactFlow's animated prop produces a dashed-line marquee — we don't
      // want that since we have our own pulse. Disable.
      animated: false,
    });
    return [
      lane("openclaw->synap", "openclaw", "synap"),
      lane("synap->openclaw", "synap",    "openclaw"),
      lane("synap->hermes",   "synap",    "hermes"),
      lane("hermes->synap",   "hermes",   "synap"),
    ];
  }, [lanes]);

  const onSelectionChange: OnSelectionChangeFunc = ({ nodes }) => {
    if (!onSelectActor) return;
    const first = nodes[0];
    onSelectActor(first ? (first.id as Actor) : null);
  };

  return (
    <div className="relative h-full min-h-0 w-full rounded-stat-card overflow-hidden">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        fitView
        fitViewOptions={{ padding: 0.25, maxZoom: 1.2, minZoom: 0.6 }}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
        panOnDrag={false}
        zoomOnScroll={false}
        zoomOnPinch={false}
        zoomOnDoubleClick={false}
        elementsSelectable
        onSelectionChange={onSelectionChange}
      >
        <Background gap={24} size={1} className="opacity-50" />
      </ReactFlow>
    </div>
  );
}
