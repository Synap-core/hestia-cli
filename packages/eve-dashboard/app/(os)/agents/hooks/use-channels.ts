"use client";

/**
 * `useChannels` — fetches the unified channel registry from the local
 * server endpoint at `/api/agents/channels` and refreshes on a 5s
 * interval (channels change rarely; per-second polling would be wasteful).
 *
 * The endpoint fans out to OpenClaw, WhatsApp Baileys, and the Synap
 * personal channel internally — see `app/api/agents/channels/route.ts`.
 *
 * NOTE on freshness: when an event lands in `useRealtimeEvents` that
 * affects connection state (e.g. WhatsApp QR scan completed), the page
 * triggers a `refresh()` immediately — see `agents/page.tsx`.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ChannelRegistryResponse,
  UnifiedChannel,
} from "../lib/channel-types";

export interface UseChannelsResult {
  channels: UnifiedChannel[];
  isLoading: boolean;
  error: string | null;
  /** True when at least one source returned an error. */
  partial: boolean;
  /** Force a re-fetch (call after a connect/disconnect mutation). */
  refresh: () => void;
}

const POLL_INTERVAL_MS = 5000;

export function useChannels(): UseChannelsResult {
  const [channels, setChannels] = useState<UnifiedChannel[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [partial, setPartial] = useState(false);
  const tickRef = useRef(0);

  const refresh = useCallback(async () => {
    const tick = ++tickRef.current;
    try {
      const res = await fetch("/api/agents/channels", {
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) {
        // 401 means the dashboard's local auth is gone — middleware will
        // already be redirecting to /login. Just bail.
        if (res.status === 401) return;
        throw new Error(`HTTP ${res.status}`);
      }
      const json = (await res.json()) as ChannelRegistryResponse;
      if (tickRef.current !== tick) return; // stale response
      setChannels(json.channels);
      setPartial(json.partial);
      setError(null);
    } catch (e) {
      if (tickRef.current !== tick) return;
      setError(e instanceof Error ? e.message : "Failed to load channels");
    } finally {
      if (tickRef.current === tick) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => {
      clearInterval(t);
      tickRef.current += 1;
    };
  }, [refresh]);

  return { channels, isLoading, error, partial, refresh };
}
