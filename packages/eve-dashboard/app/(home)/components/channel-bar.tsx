"use client";

/**
 * `ChannelBar` — sticky bottom bar listing connected interaction
 * channels (Telegram, WhatsApp, Voice…). Fades into the page
 * background — no hard top border.
 *
 * Phase 2A: `/api/channels/status` doesn't exist yet, so the hook
 * returns a stub set with all channels offline. The chevron link
 * routes to `/settings/channels` (the existing config page).
 */

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useChannelStatus, type ChannelStatusKind } from "../hooks/use-channel-status";

const DOT: Record<ChannelStatusKind, string> = {
  online:   "bg-status-online",
  degraded: "bg-status-degraded",
  offline:  "bg-status-offline",
};

export function ChannelBar() {
  const { channels, isStub } = useChannelStatus();

  const anyConfigured = channels.some(c => c.configured);

  return (
    <div
      className="
        sticky bottom-0 -mx-6 lg:-mx-10 mt-10
        h-14 px-6 lg:px-10
        flex items-center gap-4
        bg-gradient-to-t from-background via-background/85 to-background/0
        backdrop-blur-[1px]
      "
      aria-label="Channels"
    >
      <span className="text-xs font-medium uppercase tracking-wider text-default-400">
        Channels
      </span>

      {anyConfigured ? (
        <ul className="flex items-center gap-3 text-sm overflow-x-auto">
          {channels.map(c => (
            <li
              key={c.id}
              className={
                "flex items-center gap-1.5 shrink-0 " +
                (c.configured ? "text-foreground" : "text-default-400")
              }
              title={
                isStub
                  ? `${c.name} — channel-status API not yet implemented`
                  : `${c.name} (${c.status})`
              }
            >
              <span className={`h-1.5 w-1.5 rounded-full ${DOT[c.status]}`} aria-hidden />
              <span className="text-[13px]">{c.name}</span>
            </li>
          ))}
        </ul>
      ) : (
        <Link
          href="/settings/channels"
          className="text-sm text-default-500 hover:text-primary transition-colors"
          title={isStub ? "channel-status API not yet implemented" : undefined}
        >
          Connect a channel <span aria-hidden>→</span>
        </Link>
      )}

      <Link
        href="/settings/channels"
        aria-label="Manage channels"
        className="
          ml-auto inline-flex h-8 w-8 items-center justify-center rounded-md
          text-default-500 hover:text-foreground hover:bg-content2
          transition-colors
        "
      >
        <ArrowRight className="h-4 w-4" />
      </Link>
    </div>
  );
}
