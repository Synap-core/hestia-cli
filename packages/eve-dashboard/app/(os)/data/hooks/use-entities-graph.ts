"use client";

/**
 * Data app's composed query. Each of the three round-trips below goes through
 * the canonical `usePodQuery` helper, so scope handling (workspace vs
 * user-wide) is unified with the rest of Eve OS:
 *
 *   1. `entities.list`         → list of entities the user can see in the
 *                                current scope. In user-wide mode this is
 *                                served by the `.listAll` variant on the pod
 *                                (or fan-out across workspaces as a compat
 *                                path while the backend variant lands).
 *   2. `graph.getSubgraph`     → entities + relations for the IDs from (1).
 *                                Scope-agnostic — takes IDs directly.
 *   3. `graph.getStats`        → totals for the side panel. User-wide today
 *                                via skipFanout; will swap to `.listAllStats`
 *                                once exposed.
 *
 * The hook orchestrates the three states into one tagged union so the page
 * doesn't need to think about which query is in flight.
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

interface EntitiesListResponse {
  items?: Array<Record<string, unknown>>;
  entities?: Array<Record<string, unknown>>;
}

interface SubgraphResponse {
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

// ─── Merge two PodQueryState branches ─────────────────────────────────────────

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
  // 1. List entities — scope-aware. User-wide scope prefers entities.listAll
  // when the pod exposes it, otherwise fans out across workspaces + globals.
  const entitiesQuery = usePodQuery<EntitiesListResponse>(
    "entities.list",
    { limit: 200 },
    { userWideProcedure: "entities.listAll" },
  );

  // Extract the entity ID list for the subgraph query.
  const entityIds = useMemo(() => {
    if (entitiesQuery.state.kind !== "ready") return [] as string[];
    const items =
      entitiesQuery.state.data.items ??
      entitiesQuery.state.data.entities ??
      [];
    return items.map((e) => String(e.id));
  }, [entitiesQuery.state]);

  // 2. Subgraph — entity-IDs in, edges + nodes out. Workspace-agnostic.
  const subgraphQuery = usePodQuery<SubgraphResponse>(
    "graph.getSubgraph",
    { entityIds },
    {
      skipFanout: true,
      enabled: entityIds.length > 0,
    },
  );

  // 3. Stats — `graph.getStats` is already a `protectedProcedure` filtered
  // by `userId` (not workspaceId), so it's natively user-wide. We call it
  // directly with no workspace header.
  const statsQuery = usePodQuery<GraphStats>(
    "graph.getStats",
    {},
    { skipFanout: true },
  );

  // ─── Compose ────────────────────────────────────────────────────────────────
  const composed: GraphState = useMemo(() => {
    const status = mergeStates(
      entitiesQuery.state,
      subgraphQuery.state,
      statsQuery.state,
    );

    if (status === "unpaired") return { kind: "unpaired" };
    if (status === "error") {
      return {
        kind: "error",
        message: firstErrorMessage(
          entitiesQuery.state,
          subgraphQuery.state,
          statsQuery.state,
        ),
      };
    }

    // While loading, allow a "ready empty" if we got an empty entities list
    // (no point waiting on graph queries that will be skipped).
    if (entitiesQuery.state.kind === "ready" && entityIds.length === 0) {
      return {
        kind: "ready",
        entities: [],
        relations: [],
        stats: { totalEntities: 0 },
      };
    }

    if (status === "loading") return { kind: "loading" };

    const subgraph =
      subgraphQuery.state.kind === "ready" ? subgraphQuery.state.data : {};
    const stats =
      statsQuery.state.kind === "ready" ? statsQuery.state.data : {};

    return {
      kind: "ready",
      entities: (subgraph.entities ?? []).map(normalizeEntity),
      relations: (subgraph.relations ?? []).map(normalizeRelation),
      stats,
    };
  }, [entitiesQuery.state, subgraphQuery.state, statsQuery.state, entityIds]);

  return {
    state: composed,
    refresh: () => {
      entitiesQuery.refresh();
      subgraphQuery.refresh();
      statsQuery.refresh();
    },
  };
}
