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
import { Button, ButtonGroup, Chip, Tooltip } from "@heroui/react";
import { Plug, AlertTriangle, RefreshCw, Activity, LayoutDashboard, ListOrdered, Beaker } from "lucide-react";
import type { EventName } from "./lib/event-types";
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

type ViewMode = "compact" | "timeline";
const VIEW_MODE_PREF_KEY = "eve.agents.viewMode";

export default function AgentsPage() {
  const [selectedAgent, setSelectedAgent] = useState<AgentId | null>(null);
  const [highlightedLane, setHighlightedLane] = useState<Lane | null>(null);
  const [isConnectOpen, setIsConnectOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("compact");

  // Hydrate persisted view mode once on mount.
  useEffect(() => {
    try {
      const v = localStorage.getItem(VIEW_MODE_PREF_KEY);
      if (v === "timeline" || v === "compact") setViewMode(v);
    } catch { /* localStorage disabled */ }
  }, []);

  const updateViewMode = useCallback((next: ViewMode) => {
    setViewMode(next);
    try { localStorage.setItem(VIEW_MODE_PREF_KEY, next); } catch { /* noop */ }
  }, []);

  const {
    events,
    status,
    reconnect,
    byAgent,
    agentStatuses,
    eventsPerMinute,
    errors24h,
    pushSynthetic,
  } = useRealtimeEvents({ bufferSize: 200 });

  // Round-trip a synthetic event through the API so the same code path
  // exercises auth + body parsing in addition to the local rendering.
  const sendTestEvent = useCallback(
    async (name?: EventName) => {
      try {
        const res = await fetch("/api/agents/test-event", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(name ? { name } : {}),
        });
        if (!res.ok) return;
        const data = (await res.json()) as { name: EventName; payload: unknown };
        pushSynthetic(data.name, data.payload);
      } catch {
        // Network failure swallowed — UI surfaces nothing here on purpose.
      }
    },
    [pushSynthetic],
  );

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

  // Refresh the channel registry whenever a "connection state" event
  // lands — e.g. user just connected Telegram → next OpenClaw event
  // tells us the channel is live. This keeps the strip honest without
  // a 1s poll.
  //
  // The hook intentionally watches `events.length` rather than `events`
  // itself (no need to re-fire on every individual rerender of the same
  // array). `refreshChannels` is stable from useCallback.
  useEffect(() => {
    if (events.length === 0) return;
    const newest = events[0];
    if (
      newest.name.startsWith("openclaw:") ||
      newest.name === "synap:reply:routed"
    ) {
      refreshChannels();
    }
  }, [events, refreshChannels]);

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
            <ButtonGroup
              size="sm"
              radius="full"
              variant="flat"
              className="ml-1"
              aria-label="View mode"
            >
              <Button
                isIconOnly
                aria-label="Compact view (graph + feed)"
                aria-pressed={viewMode === "compact"}
                onPress={() => updateViewMode("compact")}
                className={
                  viewMode === "compact"
                    ? "bg-foreground/[0.10] text-foreground"
                    : "text-foreground/55 hover:text-foreground"
                }
              >
                <LayoutDashboard className="h-3.5 w-3.5" />
              </Button>
              <Button
                isIconOnly
                aria-label="Timeline view (full feed)"
                aria-pressed={viewMode === "timeline"}
                onPress={() => updateViewMode("timeline")}
                className={
                  viewMode === "timeline"
                    ? "bg-foreground/[0.10] text-foreground"
                    : "text-foreground/55 hover:text-foreground"
                }
              >
                <ListOrdered className="h-3.5 w-3.5" />
              </Button>
            </ButtonGroup>
            <Tooltip
              content="Inject a synthetic event to verify the pipeline"
              placement="bottom"
              delay={300}
              size="sm"
            >
              <Button
                isIconOnly
                size="sm"
                radius="full"
                variant="light"
                aria-label="Send a test event"
                onPress={() => void sendTestEvent()}
                className="text-foreground/55 hover:text-foreground"
              >
                <Beaker className="h-3.5 w-3.5" />
              </Button>
            </Tooltip>
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

        {/* Graph — only in compact mode. Fixed height: 320 on small, 380 on lg. */}
        {viewMode === "compact" && (
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
          </div>
        )}

        {/* Channel strip — always visible. Doubles as the first-run CTA when
            there are no channels yet (its empty state already says
            "No channels connected yet · Connect a channel"). */}
        <div className="shrink-0 mb-3">
          <ChannelStrip
            channels={channels}
            isLoading={isChannelsLoading}
            partial={channelsPartial}
            onConnect={() => setIsConnectOpen(true)}
          />
        </div>

        {/* Activity feed — fills remaining height. In timeline mode it
            owns the whole pane below the channel strip; in compact mode
            it shares space with the graph above. */}
        <div className="min-h-0 flex-1">
          <ActivityFeed
            events={events}
            isEmpty={isEmpty}
            onHighlightLane={viewMode === "compact" ? setHighlightedLane : undefined}
            density={viewMode === "timeline" ? "timeline" : "compact"}
            onSendTestEvent={() => void sendTestEvent()}
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

