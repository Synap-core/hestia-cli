"use client";

/**
 * Agents app — Synap-centered radial graph + always-visible activity feed.
 *
 * Layout (top → bottom inside the pane body):
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ Header: Agents · ⚡ N events/min · K errors    [Connect]      │
 *   ├──────────────────────────────────────────────────────────────┤
 *   │ AgentGraph    (radial; Synap center, agents around)          │
 *   ├──────────────────────────────────────────────────────────────┤
 *   │ ChannelStrip  (Telegram · Discord · WhatsApp · Synap · …)    │
 *   ├──────────────────────────────────────────────────────────────┤
 *   │ ActivityFeed  (filtered list, click row → highlight lane)    │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * Both surfaces (graph + feed) read from the same `useRealtimeEvents`
 * hook → no duplicate sockets, no buffer drift.
 *
 * The previous Flow / Timeline view toggle is gone — they were
 * complementary, not alternatives. Side panel slides in over the graph
 * when an agent node is clicked; closes on Esc or backdrop click.
 *
 * See: synap-team-docs/content/team/platform/eve-agents-design.mdx
 */

import { useCallback, useEffect, useState } from "react";
import { Button, Chip } from "@heroui/react";
import { Plug, AlertTriangle, RefreshCw, Sparkles, Activity } from "lucide-react";
import { PaneHeader } from "../components/pane-header";
import { CpAuthBanner } from "../../components/cp-auth-banner";
import { AgentGraph } from "./components/agent-graph";
import { ActivityFeed } from "./components/activity-feed";
import { ChannelStrip } from "./components/channel-strip";
import { NodePanel } from "./components/node-panel";
import { ConnectChannelsModal } from "./components/connect-channels-modal";
import { useRealtimeEvents } from "./hooks/use-realtime-events";
import { useChannels } from "./hooks/use-channels";
import type { AgentId, Lane } from "./lib/agent-registry";

export default function AgentsPage() {
  const [selectedAgent, setSelectedAgent] = useState<AgentId | null>(null);
  const [highlightedLane, setHighlightedLane] = useState<Lane | null>(null);
  const [isConnectOpen, setIsConnectOpen] = useState(false);

  const {
    events,
    status,
    reconnect,
    byAgent,
    agentStatuses,
    eventsPerMinute,
    errors24h,
  } = useRealtimeEvents({ bufferSize: 200 });

  const {
    channels,
    isLoading: isChannelsLoading,
    partial: channelsPartial,
    refresh: refreshChannels,
  } = useChannels();

  const isUnauthenticated = status.kind === "unauthenticated";
  const isConnecting = status.kind === "connecting";
  const isError = status.kind === "error";
  const isEmpty = events.length === 0;
  const hasNoChannels = !isChannelsLoading && channels.length === 0;

  // Refresh the channel registry whenever a "connection state" event
  // lands — e.g. user just connected Telegram → next OpenClaw event
  // tells us the channel is live. This keeps the strip honest without
  // a 1s poll.
  useEffect(() => {
    if (events.length === 0) return;
    const newest = events[0];
    if (
      newest.name.startsWith("openclaw:") ||
      newest.name === "synap:reply:routed"
    ) {
      refreshChannels();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events.length]);

  // Auto-clear highlighted lane after 1.5s.
  useEffect(() => {
    if (!highlightedLane) return;
    const t = window.setTimeout(() => setHighlightedLane(null), 1500);
    return () => window.clearTimeout(t);
  }, [highlightedLane]);

  // Esc closes the side panel.
  useEffect(() => {
    if (!selectedAgent) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedAgent(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedAgent]);

  const onCloseConnect = useCallback(() => {
    setIsConnectOpen(false);
    // Re-fetch channels so the strip reflects what was just connected.
    refreshChannels();
  }, [refreshChannels]);

  const highlightedLaneKey = highlightedLane
    ? `${highlightedLane.from}->${highlightedLane.to}`
    : null;

  return (
    <>
      <PaneHeader
        title="Agents"
        actions={
          <>
            <HeaderStat
              icon={Activity}
              value={`${eventsPerMinute}/min`}
              hint="events"
              tone={eventsPerMinute > 0 ? "live" : "muted"}
            />
            {errors24h > 0 && (
              <HeaderStat
                icon={AlertTriangle}
                value={String(errors24h)}
                hint="errors"
                tone="error"
              />
            )}
            <Button
              size="sm"
              radius="full"
              color="primary"
              variant="flat"
              startContent={<Plug className="h-3.5 w-3.5" />}
              onPress={() => setIsConnectOpen(true)}
              className="ml-1"
            >
              Connect
            </Button>
          </>
        }
      />

      {/* Body — concentric: pane 32 → gutter 20 → card 12 */}
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden px-5 pb-5 pt-4 sm:px-6 sm:pt-5">
        {/* Status banners */}
        {(isUnauthenticated || isError || isConnecting) && (
          <div className="mb-3">
            {isUnauthenticated && (
              <CpAuthBanner
                state={{ kind: "signed-out" }}
                onRetry={reconnect}
              />
            )}
            {isError && status.kind === "error" && (
              <ErrorBanner message={status.message} onRetry={reconnect} />
            )}
            {isConnecting && <ConnectingBanner />}
          </div>
        )}

        {/* Graph — fixed-ish height, 320px on small screens, 380px on lg */}
        <div className="relative shrink-0 mb-3 h-[320px] lg:h-[380px]">
          <AgentGraph
            events={events}
            agentStatuses={agentStatuses}
            selectedAgent={selectedAgent}
            onSelectAgent={(id) =>
              setSelectedAgent((prev) => (prev === id ? null : id))
            }
            channels={channels}
            highlightedLane={highlightedLaneKey}
          />

          {/* Side panel slides in over the graph */}
          {selectedAgent && (
            <NodePanel
              agentId={selectedAgent}
              events={byAgent[selectedAgent] ?? []}
              status={agentStatuses[selectedAgent]}
              onClose={() => setSelectedAgent(null)}
              onSelectAgent={(id) => setSelectedAgent(id)}
            />
          )}

          {/* First-run hint — only when graph would otherwise feel dead */}
          {isEmpty &&
            hasNoChannels &&
            status.kind === "connected" && (
              <FirstRunHint onOpenConnect={() => setIsConnectOpen(true)} />
            )}
        </div>

        {/* Channel strip */}
        <div className="shrink-0 mb-3">
          <ChannelStrip
            channels={channels}
            isLoading={isChannelsLoading}
            partial={channelsPartial}
            onConnect={() => setIsConnectOpen(true)}
          />
        </div>

        {/* Activity feed — fills remaining height */}
        <div className="min-h-0 flex-1">
          <ActivityFeed
            events={events}
            isEmpty={isEmpty}
            onHighlightLane={setHighlightedLane}
          />
        </div>
      </div>

      <ConnectChannelsModal
        isOpen={isConnectOpen}
        onClose={onCloseConnect}
      />
    </>
  );
}

// ─── Header stats ────────────────────────────────────────────────────────────

function HeaderStat({
  icon: Icon,
  value,
  hint,
  tone,
}: {
  icon: typeof Plug;
  value: string;
  hint: string;
  tone: "live" | "muted" | "error";
}) {
  const colorClass =
    tone === "error"
      ? "text-danger"
      : tone === "live"
        ? "text-success"
        : "text-foreground/55";

  return (
    <span className="hidden items-center gap-1 sm:inline-flex">
      <Icon className={`h-3 w-3 ${colorClass}`} strokeWidth={2.2} />
      <span className="text-[11.5px] tabular-nums text-foreground/85">
        {value}
      </span>
      <span className="text-[11px] text-foreground/55">{hint}</span>
    </span>
  );
}

// ─── Inline banners ──────────────────────────────────────────────────────────

function ErrorBanner({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div
      className="
        flex flex-row items-center gap-3 rounded-lg
        bg-danger/10 px-4 py-2.5
        border border-danger/30
      "
    >
      <AlertTriangle className="h-4 w-4 shrink-0 text-danger" strokeWidth={2} />
      <p className="flex-1 min-w-0 text-[13px] text-foreground">
        Realtime stream error{" "}
        <span className="text-foreground/55">— {message}</span>
      </p>
      <Button
        size="sm"
        radius="full"
        color="danger"
        variant="flat"
        startContent={<RefreshCw className="h-3 w-3" />}
        onPress={onRetry}
      >
        Retry
      </Button>
    </div>
  );
}

function ConnectingBanner() {
  return (
    <div
      className="
        flex flex-row items-center gap-3 rounded-lg
        bg-foreground/[0.04] px-4 py-2.5
        border border-foreground/[0.08]
      "
    >
      <Chip size="sm" radius="full" variant="flat">
        connecting
      </Chip>
      <p className="flex-1 min-w-0 text-[13px] text-foreground/65">
        Connecting to your pod's realtime stream…
      </p>
    </div>
  );
}

function FirstRunHint({ onOpenConnect }: { onOpenConnect: () => void }) {
  return (
    <div className="absolute inset-x-0 bottom-3 flex justify-center pointer-events-none">
      <div
        className="
          flex flex-row items-center gap-3 rounded-lg
          bg-foreground/[0.06] px-4 py-2.5
          border border-foreground/[0.10] pointer-events-auto
        "
      >
        <Sparkles className="h-4 w-4 shrink-0 text-primary" strokeWidth={1.8} />
        <p className="text-[12.5px] text-foreground/85">
          Waiting for activity. Connect a channel to see your AI staff at work.
        </p>
        <Button
          size="sm"
          radius="full"
          color="primary"
          variant="flat"
          onPress={onOpenConnect}
        >
          Connect a channel
        </Button>
      </div>
    </div>
  );
}
