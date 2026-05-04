"use client";

/**
 * `useChannelStatus` — drives the bottom `<ChannelBar />`.
 *
 * Polls `/api/channels/status` every 30 s. That endpoint does NOT exist
 * yet — Phase 2A ships the bar with placeholder dots so the layout is
 * locked in. As soon as the API lands the polling loop will pick it up
 * with no UI changes.
 *
 * Each entry maps onto one dot + label in the ChannelBar.
 */

import { useEffect, useRef, useState } from "react";

export type ChannelId =
  | "telegram" | "whatsapp" | "signal" | "matrix"
  | "discord"  | "slack"    | "voice";

export type ChannelStatusKind = "online" | "offline" | "degraded";

export interface ChannelStatus {
  id: ChannelId;
  name: string;
  status: ChannelStatusKind;
  /** False = greyed out, "Connect" hint. */
  configured: boolean;
}

export interface UseChannelStatusResult {
  channels: ChannelStatus[];
  /** True until the first response (real or stub) has populated state. */
  isLoading: boolean;
  /** True when we know the endpoint is missing (404). UI uses this to
   *  surface a "TODO" tooltip in dev. */
  isStub: boolean;
}

/**
 * Default placeholder set used until /api/channels/status lands.
 * Mirrors the design wireframe (§2 of eve-os-home-design.mdx).
 */
const STUB_CHANNELS: ChannelStatus[] = [
  { id: "telegram", name: "Telegram", status: "offline", configured: false },
  { id: "whatsapp", name: "WhatsApp", status: "offline", configured: false },
  { id: "discord",  name: "Discord",  status: "offline", configured: false },
  { id: "voice",    name: "Voice",    status: "offline", configured: false },
];

interface ChannelStatusResponse {
  channels: ChannelStatus[];
}

export function useChannelStatus(): UseChannelStatusResult {
  const [channels, setChannels] = useState<ChannelStatus[]>(STUB_CHANNELS);
  const [isLoading, setIsLoading] = useState(true);
  const [isStub, setIsStub] = useState(true);
  const aborted = useRef(false);

  useEffect(() => {
    aborted.current = false;

    async function tick() {
      try {
        const res = await fetch("/api/channels/status", {
          credentials: "include",
          cache: "no-store",
        });
        if (aborted.current) return;
        if (res.ok) {
          const json = (await res.json()) as ChannelStatusResponse;
          setChannels(Array.isArray(json.channels) ? json.channels : STUB_CHANNELS);
          setIsStub(false);
        } else {
          // 404 = endpoint not implemented yet, anything else = error.
          // Either way, keep the stub set so the bar still renders.
          setChannels(STUB_CHANNELS);
          setIsStub(true);
        }
      } catch {
        if (aborted.current) return;
        setChannels(STUB_CHANNELS);
        setIsStub(true);
      } finally {
        if (!aborted.current) setIsLoading(false);
      }
    }

    void tick();
    const i = setInterval(tick, 30_000);
    return () => {
      aborted.current = true;
      clearInterval(i);
    };
  }, []);

  return { channels, isLoading, isStub };
}
