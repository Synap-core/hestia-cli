"use client";

/**
 * Single-shot fetch of the operator's pod entities + relations for the Data
 * app graph. Mirrors the studio graph page's data flow:
 *
 *   1. `entities.list` (limit 50)        — seed batch of entities
 *   2. `graph.getSubgraph` (entityIds)   — full subgraph for those seeds
 *   3. `graph.getStats` ({})             — totals for the side panel
 *
 * Returns `{ kind: "loading" | "ready" | "unpaired" | "error" }`. The
 * "unpaired" branch carries no data — the page renders PodNotPairedCard
 * and CTAs back into `/settings`.
 */

import { useCallback, useEffect, useState } from "react";
import { podTrpcFetch, PodTrpcError } from "../../inbox/lib/pod-fetch";

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

interface ListResponse {
  items?: Array<{ id: string }>;
  entities?: Array<{ id: string }>;
}

interface SubgraphResponse {
  entities?: Array<Record<string, unknown>>;
  relations?: Array<Record<string, unknown>>;
}

function normalizeEntity(raw: Record<string, unknown>): GraphEntity {
  return {
    id: String(raw.id),
    title: (raw.title as string) ?? (raw.name as string) ?? null,
    profileSlug: (raw.profileSlug as string) ?? null,
    type: (raw.type as string) ?? (raw.profileSlug as string) ?? null,
  };
}

function normalizeRelation(raw: Record<string, unknown>): GraphRelation {
  return {
    id: String(raw.id),
    sourceId: String(
      raw.sourceEntityId ?? raw.sourceId ?? raw.source,
    ),
    targetId: String(
      raw.targetEntityId ?? raw.targetId ?? raw.target,
    ),
    type: (raw.relationType as string) ?? (raw.type as string) ?? null,
  };
}

export function useEntitiesGraph(): {
  state: GraphState;
  refresh: () => void;
} {
  const [state, setState] = useState<GraphState>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setState({ kind: "loading" });
      try {
        const list = await podTrpcFetch<ListResponse>("entities.list", {
          limit: 50,
        });
        if (cancelled) return;

        const seed = list.items ?? list.entities ?? [];
        const entityIds = seed.map((e) => e.id);

        if (entityIds.length === 0) {
          setState({
            kind: "ready",
            entities: [],
            relations: [],
            stats: { totalEntities: 0 },
          });
          return;
        }

        const [subgraph, stats] = await Promise.all([
          podTrpcFetch<SubgraphResponse>("graph.getSubgraph", { entityIds }),
          podTrpcFetch<GraphStats>("graph.getStats", {}).catch(() => ({})),
        ]);
        if (cancelled) return;

        setState({
          kind: "ready",
          entities: (subgraph.entities ?? []).map(normalizeEntity),
          relations: (subgraph.relations ?? []).map(normalizeRelation),
          stats: stats ?? {},
        });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof PodTrpcError && err.status === 503) {
          setState({ kind: "unpaired" });
          return;
        }
        setState({
          kind: "error",
          message:
            err instanceof Error ? err.message : "Failed to load graph",
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const refresh = useCallback(() => setReloadKey((k) => k + 1), []);

  return { state, refresh };
}
