"use client";

/**
 * `useStats` — surfaces the three Home stat cards.
 *
 * Three parallel signals. Each fails independently — a slow agent
 * registry doesn't gate the events count, etc.
 *
 *   • agentsRunning   — agents emitting heartbeats in the last 60s
 *   • eventsToday     — Hub Protocol events.since(startOfDay)
 *   • updatesAvailable — marketplace apps with newer version installed
 *
 * Phase 2A wires up best-effort fetches against existing Eve dashboard
 * routes. When a source is unavailable (route not yet implemented, pod
 * unreachable) the corresponding value falls back to 0 with a sublabel
 * that softens the meaning ("Hub unreachable" vs "All quiet"). The card
 * never disappears — calm is the point.
 *
 * See: synap-team-docs/content/team/platform/eve-os-home-design.mdx §4
 */

import { useCallback, useEffect, useState } from "react";

export interface StatCardData {
  agentsRunning: number;
  agentsSubLabel?: string;
  eventsToday: number;
  eventsSubLabel?: string;
  updatesAvailable: number;
  updatesSubLabel?: string;
}

const ZERO: StatCardData = {
  agentsRunning: 0,
  eventsToday: 0,
  updatesAvailable: 0,
};

interface UseStatsResult {
  stats: StatCardData;
  isLoading: boolean;
  refetch: () => void;
}

async function safeFetchJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(path, { credentials: "include", cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

interface AgentSummary {
  count: number;
  busy?: string | null;
}
interface EventCountSummary {
  count: number;
  scope?: string;
}
interface UpdatesSummary {
  count: number;
}

export function useStats(): UseStatsResult {
  const [stats, setStats] = useState<StatCardData>(ZERO);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    setIsLoading(true);

    // Fire all three in parallel; surface whatever resolves.
    const [agents, events, updates] = await Promise.all([
      safeFetchJson<AgentSummary>("/api/stats/agents"),
      safeFetchJson<EventCountSummary>("/api/stats/events-today"),
      safeFetchJson<UpdatesSummary>("/api/stats/updates"),
    ]);

    setStats({
      agentsRunning: agents?.count ?? 0,
      agentsSubLabel: agents
        ? agents.count === 0
          ? "All quiet"
          : agents.busy ?? undefined
        : undefined,
      eventsToday: events?.count ?? 0,
      eventsSubLabel: events
        ? events.scope ?? "across all channels"
        : undefined,
      updatesAvailable: updates?.count ?? 0,
      updatesSubLabel: updates
        ? updates.count === 0
          ? "All up to date"
          : "Tap to review"
        : undefined,
    });
    setIsLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { stats, isLoading, refetch: load };
}
