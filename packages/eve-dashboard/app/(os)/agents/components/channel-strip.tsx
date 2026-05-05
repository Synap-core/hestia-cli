"use client";

/**
 * `ChannelStrip` — horizontal row of connected channels, just below the
 * graph. Each chip shows kind, label, and live state at a glance. Click
 * a chip → opens the channel via its `openTarget`:
 *
 *   • External (Telegram/Discord/WA…) → tries the URL scheme; falls back
 *     to the http web client. Same loopback-probe pattern as the
 *     marketplace install handoff. Browsers without the scheme handler
 *     get an opener-tab to the http fallback after ~600ms.
 *   • Synap → opens app.synap.live in a new tab. Solid.
 *   • A2A → in-Eve drilldown (deferred — v1 just renders, click is a
 *     no-op until the IS exposes A2A pipes via Hub Protocol).
 *
 * Auto-collapses to a "Connect a channel" CTA when zero channels exist.
 * Otherwise shows everything inline — no modal, no drawer.
 *
 * See: synap-team-docs/content/team/platform/eve-agents-design.mdx §M3
 */

import { Button, Chip, Spinner } from "@heroui/react";
import {
  AlertTriangle, Check, MessageSquare, Send, Smartphone, Plug,
  Brain, Bot, Globe,
  type LucideIcon,
} from "lucide-react";
import type {
  ChannelKind,
  ChannelOpenTarget,
  UnifiedChannel,
} from "../lib/channel-types";

const KIND_GLYPH: Record<ChannelKind, LucideIcon> = {
  telegram: Send,
  discord:  MessageSquare,
  whatsapp: Smartphone,
  signal:   Smartphone,
  matrix:   MessageSquare,
  synap:    Brain,
  a2a:      Bot,
};

const KIND_ACCENT: Record<ChannelKind, string> = {
  telegram: "#26A5E4", // Telegram brand
  discord:  "#5865F2", // Discord blurple
  whatsapp: "#25D366", // WhatsApp green
  signal:   "#3A76F0", // Signal blue
  matrix:   "#0DBD8B", // Matrix green
  synap:    "#34D399", // Eve emerald
  a2a:      "#A78BFA", // OpenClaw violet (A2A flows through OpenClaw too)
};

export interface ChannelStripProps {
  channels: UnifiedChannel[];
  isLoading: boolean;
  partial: boolean;
  /** Triggered when the strip's "+ Connect" button is clicked. */
  onConnect: () => void;
}

export function ChannelStrip({
  channels,
  isLoading,
  partial,
  onConnect,
}: ChannelStripProps) {
  if (isLoading && channels.length === 0) {
    return (
      <div className="flex h-9 items-center gap-2 px-1 text-[12px] text-foreground/55">
        <Spinner size="sm" />
        Loading channels…
      </div>
    );
  }

  if (channels.length === 0) {
    return (
      <div className="flex flex-wrap items-center gap-2 px-1">
        <p className="text-[12.5px] text-foreground/65">
          No channels connected yet.
        </p>
        <Button
          size="sm"
          radius="full"
          variant="flat"
          color="primary"
          startContent={<Plug className="h-3.5 w-3.5" />}
          onPress={onConnect}
        >
          Connect a channel
        </Button>
        {partial && (
          <span className="ml-1 inline-flex items-center gap-1 text-[11px] text-foreground/55">
            <AlertTriangle className="h-3 w-3" /> Some sources unavailable
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 px-1">
      {channels.map((ch) => (
        <ChannelChip key={ch.id} channel={ch} />
      ))}
      <Button
        size="sm"
        radius="full"
        variant="light"
        color="default"
        startContent={<Plug className="h-3.5 w-3.5" />}
        onPress={onConnect}
        className="text-foreground/65 hover:text-foreground"
      >
        Add
      </Button>
      {partial && (
        <span className="ml-1 inline-flex items-center gap-1 text-[11px] text-foreground/55">
          <AlertTriangle className="h-3 w-3" /> Some sources unavailable
        </span>
      )}
    </div>
  );
}

// ─── Chip ────────────────────────────────────────────────────────────────────

function ChannelChip({ channel }: { channel: UnifiedChannel }) {
  const Glyph = KIND_GLYPH[channel.kind];
  const accent = KIND_ACCENT[channel.kind];

  const handleClick = () => {
    openChannel(channel.openTarget);
  };

  // Choose the status-side affordance based on connection state.
  const indicator = (() => {
    switch (channel.connectionStatus) {
      case "connected":
        return (
          <span
            className="ml-1 h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ background: accent }}
            aria-hidden
            title="Connected"
          />
        );
      case "connecting":
        return <Spinner size="sm" color="default" className="ml-0.5" />;
      case "needs_attention":
        return (
          <AlertTriangle
            className="ml-1 h-3 w-3 shrink-0 text-warning"
            strokeWidth={2.2}
            aria-hidden
          />
        );
      case "disconnected":
        return (
          <span
            className="ml-1 h-1.5 w-1.5 shrink-0 rounded-full bg-foreground/30"
            aria-hidden
          />
        );
      case "unknown":
      default:
        return null;
    }
  })();

  // Use foreignObject-like Tailwind on a Chip — HeroUI Chip wraps content
  // through the `children` slot; visual states drive variant/color.
  const variantColor =
    channel.connectionStatus === "needs_attention"
      ? ("warning" as const)
      : channel.connectionStatus === "connected"
        ? ("default" as const)
        : ("default" as const);

  const tooltipParts = [channel.label];
  if (channel.hint) tooltipParts.push(channel.hint);
  const title = tooltipParts.join(" — ");

  return (
    <Chip
      size="sm"
      radius="full"
      variant="flat"
      color={variantColor}
      onClick={handleClick}
      className="cursor-pointer transition-colors hover:bg-foreground/[0.06]"
      startContent={
        <span
          className="
            ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full
          "
          style={{ background: `${accent}26`, color: accent }}
          aria-hidden
        >
          <Glyph className="h-2.5 w-2.5" strokeWidth={2.2} />
        </span>
      }
      endContent={indicator ?? undefined}
      title={title}
    >
      <span className="text-[12px] text-foreground">
        {channel.label}
        {channel.hint && (
          <span className="ml-1.5 text-foreground/55">{channel.hint}</span>
        )}
      </span>
    </Chip>
  );
}

// ─── Open behavior ───────────────────────────────────────────────────────────

/**
 * Best-effort cross-platform open for a `ChannelOpenTarget`.
 *
 * For external schemes we trigger navigation via a hidden iframe (won't
 * trigger a beforeunload on the parent), then fall back to the http URL
 * after 600ms if the scheme didn't catch. Same pattern as the marketplace
 * install handoff at synap.live/marketplace/install/<slug>.
 *
 * For synap targets we just window.open the URL.
 * For internal targets we use Next router's pushState via location.assign
 * (avoids importing useRouter into a presentational component).
 */
function openChannel(target: ChannelOpenTarget) {
  if (typeof window === "undefined") return;

  switch (target.kind) {
    case "synap":
      window.open(target.href, "_blank", "noopener,noreferrer");
      return;

    case "internal":
      window.location.assign(target.href);
      return;

    case "external": {
      let timer: number | null = null;
      const fallback = () => {
        timer = null;
        window.open(target.httpFallback, "_blank", "noopener,noreferrer");
      };

      // Iframe trick — hidden frame loads the scheme; if the scheme
      // handler isn't registered, the iframe silently errors and the
      // fallback fires. If it IS registered, the OS takes over before
      // the timer triggers.
      timer = window.setTimeout(fallback, 600);
      const iframe = document.createElement("iframe");
      iframe.style.display = "none";
      iframe.src = target.scheme;
      document.body.appendChild(iframe);

      // Clear iframe + timer when the page hides (scheme caught) or
      // after a generous safety timeout.
      const cleanup = () => {
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
      };
      window.setTimeout(cleanup, 1200);

      // Page hidden = OS took over. Cancel fallback if pending.
      const onHide = () => {
        if (timer != null) {
          window.clearTimeout(timer);
          timer = null;
        }
        document.removeEventListener("visibilitychange", onHide);
      };
      document.addEventListener("visibilitychange", onHide);

      return;
    }
  }
}

// Re-export for the page to share KIND_ACCENT in cross-component logic
// (e.g. graph A2A edge colors keyed on channel kind).
export { KIND_ACCENT, KIND_GLYPH };
