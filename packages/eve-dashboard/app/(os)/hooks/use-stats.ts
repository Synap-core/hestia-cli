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
 *                     (`/api/pod/trpc/events.since`). Falls back to 0
 *                     when no pod session is available yet.
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

interface WireProposal {
  id?: string;
  status?: string;
}

/**
 * tRPC + superjson envelope. The transformer wraps payload as
 * `result.data.json`. Some procedures return raw data when superjson
 * has nothing to enrich — we accept either shape.
 */
interface TrpcEnvelope<T> {
  result?: { data?: { json?: T } | T };
}

function unwrapTrpc<T>(env: TrpcEnvelope<T> | null): T | null {
  if (!env) return null;
  const data = env.result?.data;
  if (data && typeof data === "object" && "json" in data) {
    return (data as { json?: T }).json ?? null;
  }
  return (data as T) ?? null;
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

    const since = startOfTodayIso();
    // tRPC: events.since takes `{ since: Date }`. Superjson encodes
    // dates as `{ $type: "Date", value }` — easier here to use
    // events.list (which doesn't take a date) and filter client-side.
    // The list response is small enough (max 50) that this is fine.
    const eventsListInput = encodeURIComponent(
      JSON.stringify({ json: { limit: 50 } }),
    );
    const proposalsListInput = encodeURIComponent(
      JSON.stringify({ json: { status: "pending" } }),
    );

    const [agentsResp, eventsEnv, proposalsEnv] = await Promise.all([
      safeFetchJson<AgentsResponse>("/api/agents"),
      safeFetchJson<TrpcEnvelope<WireEvent[] | { events?: WireEvent[] }>>(
        `/api/pod/trpc/events.list?input=${eventsListInput}`,
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

    // events.list returns a bare array (per the router); accept the
    // wrapped shape too just in case.
    const eventsData = unwrapTrpc(eventsEnv);
    const eventsArr: WireEvent[] = Array.isArray(eventsData)
      ? eventsData
      : Array.isArray(eventsData?.events)
        ? eventsData.events
        : [];
    // Filter client-side to "today" since events.list doesn't take a
    // since arg. The events array carries `timestamp`/`createdAt` — we
    // accept either field name defensively.
    const sinceMs = Date.parse(since);
    const eventsToday = eventsArr.filter((e) => {
      const ts =
        (e as { timestamp?: string; createdAt?: string }).timestamp ??
        (e as { timestamp?: string; createdAt?: string }).createdAt;
      if (!ts) return false;
      const t = Date.parse(ts);
      return !Number.isNaN(t) && t >= sinceMs;
    }).length;

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
