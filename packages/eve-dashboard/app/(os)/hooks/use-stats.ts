"use client";

/**
 * `useStats` — surfaces the three Home stat pills.
 *
 * Three parallel signals. Each fails independently — a slow agent
 * registry doesn't gate the events count, etc.
 *
 *   • agentsRunning — agents whose `status` is "running" or "ready"
 *                     (from `/api/agents`).
 *   • eventsToday   — events since startOfDay via the user channel
 *                     (`/api/pod/trpc/events.read` with `lean: true`).
 *                     Falls back to 0 when no pod session is available yet.
 *   • inboxPending  — pending proposals in the operator's Inbox via
 *                     the user channel (`/api/pod/trpc/proposals.list`).
 *                     Drives the "INBOX" pill and the Core-tile count chip.
 *
 * Both pod-backed signals go through the user channel (`/api/pod/*`)
 * since they read the operator's own data — see eve-credentials.mdx
 * for the two-channel rule.
 *
 * When a source is unavailable (no pod session yet, pod unreachable)
 * the corresponding value falls back to 0 — the pill never disappears,
 * calm is the point.
 *
 * See: synap-team-docs/content/team/platform/eve-os-home-design.mdx §4
 */

import { useCallback, useEffect, useState } from "react";
import { unwrapTrpc, type TrpcEnvelope } from "@/lib/trpc-utils";

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

interface WireProposal {
  id?: string;
  status?: string;
}

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

    // `events.read` with `since` does the day-window filter on the pod
    // and `lean: true` strips data/metadata — we only need to count.
    const eventsReadInput = encodeURIComponent(
      JSON.stringify({
        json: { since: startOfTodayIso(), lean: true, limit: 500 },
      }),
    );
    const proposalsListInput = encodeURIComponent(
      JSON.stringify({ json: { status: "pending" } }),
    );

    const [agentsResp, eventsEnv, proposalsEnv] = await Promise.all([
      safeFetchJson<AgentsResponse>("/api/agents"),
      safeFetchJson<TrpcEnvelope<Array<{ id: string }>>>(
        `/api/pod/trpc/events.read?input=${eventsReadInput}`,
      ),
      safeFetchJson<
        TrpcEnvelope<
          WireProposal[] | { proposals?: WireProposal[]; items?: WireProposal[] }
        >
      >(`/api/pod/trpc/proposals.list?input=${proposalsListInput}`),
    ]);

    const runningStatuses = new Set(["running", "ready"]);
    const agentsRunning =
      agentsResp?.agents.filter((a) => runningStatuses.has(a.status)).length ?? 0;

    const eventsData = unwrapTrpc(eventsEnv);
    const eventsToday = Array.isArray(eventsData) ? eventsData.length : 0;

    const proposalsData = unwrapTrpc(proposalsEnv);
    const proposalsList: WireProposal[] = Array.isArray(proposalsData)
      ? proposalsData
      : Array.isArray(proposalsData?.proposals)
        ? proposalsData.proposals
        : Array.isArray(proposalsData?.items)
          ? proposalsData.items
          : [];
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
      eventsSubLabel: eventsEnv ? "across all channels" : undefined,
      inboxPending,
      inboxSubLabel: proposalsEnv
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
