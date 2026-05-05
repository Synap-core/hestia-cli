"use client";

/**
 * `useStats` — surfaces the three Home stat pills.
 *
 * Three parallel signals. Each fails independently — a slow agent
 * registry doesn't gate the events count, etc.
 *
 *   • agentsRunning — agents whose `status` is "running" or "ready"
 *                     (from `/api/agents`).
 *   • eventsToday   — Hub Protocol events since startOfDay
 *                     (`/api/hub/events?since=<ISO>`). Falls back to 0
 *                     when the pod isn't paired or the route is missing.
 *   • inboxPending  — pending proposals in the operator's Inbox
 *                     (`/api/hub/proposals?status=pending`). Drives the
 *                     "INBOX" pill and the Core-tile count chip.
 *
 * When a source is unavailable (route not yet implemented, pod
 * unreachable) the corresponding value falls back to 0 — the pill
 * never disappears, calm is the point.
 *
 * See: synap-team-docs/content/team/platform/eve-os-home-design.mdx §4
 */

import { useCallback, useEffect, useState } from "react";

export interface StatCardData {
  agentsRunning: number;
  agentsSubLabel?: string;
  eventsToday: number;
  eventsSubLabel?: string;
  /** Pending governance items (proposals + similar). Drives the INBOX pill. */
  inboxPending: number;
  inboxSubLabel?: string;
}

const ZERO: StatCardData = {
  agentsRunning: 0,
  eventsToday: 0,
  inboxPending: 0,
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

interface AgentRow {
  status: "running" | "ready" | "stopped" | "missing" | "unknown";
}
interface AgentsResponse {
  agents: AgentRow[];
}

interface WireEvent {
  id?: string;
}
interface EventsResponse {
  events?: WireEvent[];
}

interface WireProposal {
  id?: string;
  status?: string;
}
type ProposalsResponse =
  | { proposals: WireProposal[] }
  | WireProposal[];

function startOfTodayIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export function useStats(): UseStatsResult {
  const [stats, setStats] = useState<StatCardData>(ZERO);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    setIsLoading(true);

    const since = startOfTodayIso();
    const [agentsResp, eventsResp, proposalsResp] = await Promise.all([
      safeFetchJson<AgentsResponse>("/api/agents"),
      safeFetchJson<EventsResponse>(`/api/hub/events?since=${encodeURIComponent(since)}`),
      safeFetchJson<ProposalsResponse>("/api/hub/proposals?status=pending"),
    ]);

    const runningStatuses = new Set(["running", "ready"]);
    const agentsRunning =
      agentsResp?.agents.filter((a) => runningStatuses.has(a.status)).length ?? 0;

    const eventsToday = eventsResp?.events?.length ?? 0;

    const proposalsList: WireProposal[] = Array.isArray(proposalsResp)
      ? proposalsResp
      : proposalsResp?.proposals ?? [];
    // Belt-and-braces: if the pod ignored the status filter, count
    // pending client-side. Status === "pending" is the open lifecycle
    // bucket per the proposal codec.
    const inboxPending = proposalsList.filter(
      (p) => !p.status || p.status === "pending",
    ).length;

    setStats({
      agentsRunning,
      agentsSubLabel: agentsResp
        ? agentsRunning === 0
          ? "All quiet"
          : undefined
        : undefined,
      eventsToday,
      eventsSubLabel: eventsResp ? "across all channels" : undefined,
      inboxPending,
      inboxSubLabel: proposalsResp
        ? inboxPending === 0
          ? "Nothing pending"
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
