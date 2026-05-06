"use client";

/**
 * `useMemberCount` — surfaces the count of pod members for the Home
 * "members" stat pill.
 *
 * Reads `workspaces.listPodMembers` via the user channel
 * (`/api/pod/trpc/...`) — same two-channel rule as `useStats`. When the
 * pod session isn't ready or the procedure is unreachable the count
 * falls back to 0 (calm is the point — the pill never disappears).
 *
 * See: synap-team-docs/content/team/platform/eve-os-home-design.mdx §4
 */

import { useCallback, useEffect, useState } from "react";

interface UseMemberCountResult {
  count: number;
  isLoading: boolean;
  refetch: () => void;
}

interface WirePodMember {
  id?: string;
}

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

async function safeFetchJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(path, { credentials: "include", cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export function useMemberCount(): UseMemberCountResult {
  const [count, setCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    setIsLoading(true);
    // listPodMembers takes no input, so we still need an empty
    // superjson-shaped payload so the tRPC HTTP handler accepts the GET.
    const input = encodeURIComponent(JSON.stringify({ json: null }));
    const env = await safeFetchJson<TrpcEnvelope<WirePodMember[]>>(
      `/api/pod/trpc/workspaces.listPodMembers?input=${input}`,
    );
    const data = unwrapTrpc(env);
    setCount(Array.isArray(data) ? data.length : 0);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { count, isLoading, refetch: load };
}
