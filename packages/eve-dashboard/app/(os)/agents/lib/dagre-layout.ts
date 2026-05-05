/**
 * Dagre-based layout for the Agents graph.
 *
 * Replaces hand-rolled radial math. Dagre is the same engine the studio
 * data-structure view + workflows flow editor use; ships with the repo
 * already. We model the agent fleet as a directed left-to-right graph:
 *
 *   [channels]  →  OpenClaw  ─┐
 *                              ├─→  Synap  ─→  Hermes  ─→  workers
 *                  Personas  ─┘                               (scrape, embed)
 *
 * Properties:
 *   • No two nodes overlap — dagre guarantees rank separation.
 *   • Adding a new agent or sub-agent is a registry append; layout
 *     recomputes automatically with the same constraints.
 *   • Synap stays roughly center because it's the only shared sink for
 *     the ingress + persona ranks and the only source for the
 *     execution rank.
 *
 * Layout output is in absolute pixel coordinates. The caller positions
 * React Flow nodes at `position - size/2` (dagre returns center
 * coordinates).
 */

import dagre from "dagre";
import {
  allAgents, primaryAgents, subagentsOf,
  type AgentId, type AgentMeta,
} from "./agent-registry";

export interface LaidOutNode {
  id: AgentId;
  x: number;
  y: number;
  size: number;
}

export interface LaidOutEdge {
  source: AgentId;
  target: AgentId;
}

export interface LaidOutGraph {
  nodes: LaidOutNode[];
  edges: LaidOutEdge[];
  width: number;
  height: number;
}

const NODE_BRAIN = 96;
const NODE_PRIMARY = 72;
const NODE_SUB = 48;
const NODE_PADDING = 36; // extra room for label + status text below

function nodeSizeFor(agent: AgentMeta): number {
  if (agent.role === "brain") return NODE_BRAIN;
  return agent.parentId ? NODE_SUB : NODE_PRIMARY;
}

/**
 * Compute positions for every agent in the registry. Subagents are
 * positioned next to their parent (rank +1 from the parent), so they
 * never overlap regardless of how many siblings they have.
 *
 * Returns coordinates AND the bounding-box dimensions so the caller can
 * size the React Flow viewport.
 */
export function computeDagreLayout(): LaidOutGraph {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: "LR",
    // ranksep wider than nodesep — emphasises "data flows left → right"
    // over inter-rank crowding.
    ranksep: 110,
    nodesep: 56,
    marginx: 30,
    marginy: 30,
  });

  // Add every agent as a node sized to include label space below.
  for (const agent of allAgents()) {
    const size = nodeSizeFor(agent);
    g.setNode(agent.id, {
      width: size + NODE_PADDING,
      height: size + NODE_PADDING,
    });
  }

  // Edges:
  //   1. Synap ↔ each primary agent (the radial spokes, but as a DAG)
  //   2. Parent → subagent (worker hierarchy)
  for (const primary of primaryAgents()) {
    // Direction: ingress → synap, synap → execution. For "persona"
    // nodes (which sit in the same rank as synap), point synap → them
    // so dagre doesn't push them into a weird in-between rank.
    if (primary.role === "ingress") {
      g.setEdge(primary.id, "synap");
    } else {
      g.setEdge("synap", primary.id);
    }
  }
  for (const agent of allAgents()) {
    if (agent.parentId) {
      g.setEdge(agent.parentId, agent.id);
    }
  }

  dagre.layout(g);

  const nodes: LaidOutNode[] = allAgents().map((agent) => {
    const pos = g.node(agent.id);
    return {
      id: agent.id,
      x: pos.x,
      y: pos.y,
      size: nodeSizeFor(agent),
    };
  });

  // Collect edges in registry order so they render deterministically.
  const edges: LaidOutEdge[] = [];
  for (const primary of primaryAgents()) {
    edges.push({
      source: primary.role === "ingress" ? primary.id : "synap",
      target: primary.role === "ingress" ? "synap" : primary.id,
    });
  }
  for (const agent of allAgents()) {
    if (agent.parentId) {
      edges.push({ source: agent.parentId, target: agent.id });
    }
  }

  // Bounding box of the laid-out graph.
  const graphInfo = g.graph();
  return {
    nodes,
    edges,
    width: graphInfo.width ?? 800,
    height: graphInfo.height ?? 400,
  };
}

// Re-exports — let the graph component use one import for sub helpers.
export { subagentsOf };
