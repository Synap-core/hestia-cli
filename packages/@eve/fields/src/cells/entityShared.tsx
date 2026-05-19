"use client";
import { useEffect, useState } from "react";

import type { EntityRef, EntitySearchFn, HeroFieldSize } from "../types";

// ─── Avatar / initial bubble ──────────────────────────────────────────────────

const AVATAR_SIZE: Record<HeroFieldSize, string> = {
  sm: "w-4 h-4 text-[8px]",
  md: "w-5 h-5 text-[9px]",
  lg: "w-6 h-6 text-[10px]",
};

export function EntityAvatar({
  entity,
  size = "md",
}: {
  entity: EntityRef;
  size?: HeroFieldSize;
}) {
  const initial = entity.name.charAt(0).toUpperCase() || "?";
  if (entity.avatar) {
    return (
      <img
        src={entity.avatar}
        alt=""
        className={[
          AVATAR_SIZE[size],
          "rounded-full object-cover shrink-0",
        ].join(" ")}
      />
    );
  }
  return (
    <span
      className={[
        AVATAR_SIZE[size],
        "rounded-full bg-default-200 text-default-600 font-medium",
        "inline-flex items-center justify-center shrink-0",
      ].join(" ")}
    >
      {initial}
    </span>
  );
}

// ─── Debounced search hook ────────────────────────────────────────────────────

interface SearchState {
  results: EntityRef[];
  loading: boolean;
  error: string | null;
}

export function useEntitySearch(
  search: EntitySearchFn | undefined,
  query: string,
  enabled: boolean,
): SearchState {
  const [state, setState] = useState<SearchState>({
    results: [],
    loading: false,
    error: null,
  });

  useEffect(() => {
    if (!enabled || !search) {
      setState({ results: [], loading: false, error: null });
      return;
    }

    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));

    const handle = setTimeout(async () => {
      try {
        const result = await search(query);
        if (cancelled) return;
        setState({ results: result, loading: false, error: null });
      } catch (err) {
        if (cancelled) return;
        setState({
          results: [],
          loading: false,
          error: err instanceof Error ? err.message : "Search failed",
        });
      }
    }, 180);

    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [search, query, enabled]);

  return state;
}
