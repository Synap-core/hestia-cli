"use client";

/**
 * Data app graph query — two round trips via `usePodQuery`:
 *
 *   1. `graph.getFull`  → all entities + relations in one shot (user-wide,
 *                         up to 500 nodes). Replaces the old entities.list →
 *                         graph.getSubgraph two-step that hit the 100-ID cap.
 *   2. `graph.getStats` → totals for the side panel.
 */

import { useMemo } from "react";

import { usePodQuery, type PodQueryState } from "@/lib/use-pod-query";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GraphEntity {
  id: string;
  title?: string | null;
  profileSlug?: string | null;
  type?: string | null;
}

export interface GraphRelation {
  id: string;
  sourceId: string;
  targetId: string;
  type?: string | null;
}

export interface GraphStats {
  totalEntities?: number;
  nodeCount?: number;
  entityTypeDistribution?: Record<string, number>;
}

export type GraphState =
  | { kind: "loading" }
  | { kind: "unpaired" }
  | { kind: "error"; message: string }
  | {
      kind: "ready";
      entities: GraphEntity[];
      relations: GraphRelation[];
      stats: GraphStats;
    };

// ─── Wire response shapes ─────────────────────────────────────────────────────

interface FullGraphResponse {
  entities?: Array<Record<string, unknown>>;
  relations?: Array<Record<string, unknown>>;
}

// ─── Normalizers ──────────────────────────────────────────────────────────────

function normalizeEntity(raw: Record<string, unknown>): GraphEntity {
  return {
    id: String(raw.id),
    title: (raw.title as string) ?? (raw.name as string) ?? null,
    profileSlug: (raw.profileSlug as string) ?? (raw.type as string) ?? null,
    type: (raw.type as string) ?? (raw.profileSlug as string) ?? null,
  };
}

function normalizeRelation(raw: Record<string, unknown>): GraphRelation {
  return {
    id: String(raw.id),
    sourceId: String(raw.sourceEntityId ?? raw.sourceId ?? raw.source),
    targetId: String(raw.targetEntityId ?? raw.targetId ?? raw.target),
    type: (raw.relationType as string) ?? (raw.type as string) ?? null,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mergeStates(
  ...states: Array<PodQueryState<unknown>>
): "loading" | "unpaired" | "error" | "ready" {
  if (states.some((s) => s.kind === "unpaired")) return "unpaired";
  if (states.some((s) => s.kind === "error")) return "error";
  if (states.some((s) => s.kind === "loading")) return "loading";
  return "ready";
}

function firstErrorMessage(...states: Array<PodQueryState<unknown>>): string {
  for (const s of states) {
    if (s.kind === "error") return s.message;
  }
  return "Failed to load graph";
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useEntitiesGraph(): {
  state: GraphState;
  refresh: () => void;
} {
  // 1. Full graph — entities + relations in one pod query, user-wide (podProcedure).
  const fullQuery = usePodQuery<FullGraphResponse>(
    "graph.getFull",
    { limit: 500 },
    { skipFanout: true },
  );

  // 2. Stats for the side panel.
  const statsQuery = usePodQuery<GraphStats>(
    "graph.getStats",
    {},
    { skipFanout: true },
  );

  const composed: GraphState = useMemo(() => {
    const status = mergeStates(fullQuery.state, statsQuery.state);

    if (status === "unpaired") return { kind: "unpaired" };
    if (status === "error") {
      return {
        kind: "error",
        message: firstErrorMessage(fullQuery.state, statsQuery.state),
      };
    }
    if (status === "loading") return { kind: "loading" };

    const full = fullQuery.state.kind === "ready" ? fullQuery.state.data : {};
    const stats = statsQuery.state.kind === "ready" ? statsQuery.state.data : {};

    return {
      kind: "ready",
      entities: (full.entities ?? []).map(normalizeEntity),
      relations: (full.relations ?? []).map(normalizeRelation),
      stats,
    };
  }, [fullQuery.state, statsQuery.state]);

  return {
    state: composed,
    refresh: () => {
      fullQuery.refresh();
      statsQuery.refresh();
    },
  };
}
