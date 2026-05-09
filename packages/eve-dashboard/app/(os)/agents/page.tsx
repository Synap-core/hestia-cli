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

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, ButtonGroup, Chip, Tooltip } from "@heroui/react";
import { Plug, AlertTriangle, RefreshCw, Activity, LayoutDashboard, ListOrdered, Beaker, PanelRightClose, PanelRightOpen } from "lucide-react";
import type { EventName } from "./lib/event-types";
import { PaneHeader } from "../components/pane-header";
import { CpAuthBanner } from "../../components/cp-auth-banner";
import { AgentGraph } from "./components/agent-graph";
import { ActivityFeed } from "./components/activity-feed";
import { ChannelStrip } from "./components/channel-strip";
import { NodePanel } from "./components/node-panel";
import { TimelineCanvas } from "./components/timeline-canvas";
import { ConnectChannelsModal } from "./components/connect-channels-modal";
import { useRealtimeEvents } from "./hooks/use-realtime-events";
import { useChannels } from "./hooks/use-channels";
import { useComponentStatus } from "./hooks/use-component-status";
import type { AgentId, AgentStatusSnapshot, Lane } from "./lib/agent-registry";

type ViewMode = "compact" | "timeline";
const VIEW_MODE_PREF_KEY = "eve.agents.viewMode";
const RAIL_COLLAPSED_PREF_KEY = "eve.agents.activityRail.collapsed";

export default function AgentsPage() {
  const [selectedAgent, setSelectedAgent] = useState<AgentId | null>(null);
  const [highlightedLane, setHighlightedLane] = useState<Lane | null>(null);
  const [isConnectOpen, setIsConnectOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("compact");
  const [isRailCollapsed, setIsRailCollapsed] = useState(false);

  // Hydrate persisted prefs once on mount.
  useEffect(() => {
    try {
      const v = localStorage.getItem(VIEW_MODE_PREF_KEY);
      if (v === "timeline" || v === "compact") setViewMode(v);
      const r = localStorage.getItem(RAIL_COLLAPSED_PREF_KEY);
      if (r === "1") setIsRailCollapsed(true);
    } catch { /* localStorage disabled */ }
  }, []);

  const updateViewMode = useCallback((next: ViewMode) => {
    setViewMode(next);
    try { localStorage.setItem(VIEW_MODE_PREF_KEY, next); } catch { /* noop */ }
  }, []);

  const toggleRail = useCallback(() => {
    setIsRailCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(RAIL_COLLAPSED_PREF_KEY, next ? "1" : "0");
      } catch { /* noop */ }
      return next;
    });
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

  const { componentOverrides } = useComponentStatus();

  // Merge component health into event-derived statuses. Component health wins
  // only when it signals "error" (container down / entity-state error). When
  // the component is healthy, event-derived status (active / idle) takes
  // precedence so the graph continues to reflect live traffic.
  const mergedStatuses = useMemo<Record<AgentId, AgentStatusSnapshot>>(() => {
    if (Object.keys(componentOverrides).length === 0) return agentStatuses;
    const result = { ...agentStatuses };
    for (const agentId of Object.keys(componentOverrides) as AgentId[]) {
      const override = componentOverrides[agentId];
      if (!override || override.agentStatus !== "error") continue;
      const snap = result[agentId];
      if (snap && snap.status !== "error") {
        result[agentId] = { ...snap, status: "error" };
      }
    }
    return result;
  }, [agentStatuses, componentOverrides]);

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

        {/* Main split — primary canvas (graph or timeline) + collapsible
            activity rail on the right. */}
        <div className="flex min-h-0 flex-1 gap-3 mb-3">
          <div className="relative min-w-0 flex-1">
            {viewMode === "compact" ? (
              <>
                <AgentGraph
                  events={events}
                  agentStatuses={mergedStatuses}
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
                    status={mergedStatuses[selectedAgent]}
                    onClose={() => setSelectedAgent(null)}
                    onSelectAgent={(id) => setSelectedAgent(id)}
                  />
                )}
              </>
            ) : (
              <TimelineCanvas
                events={events}
                agentStatuses={mergedStatuses}
                isEmpty={isEmpty}
                onSelectAgent={setSelectedAgent}
                onSendTestEvent={() => void sendTestEvent()}
              />
            )}
          </div>

          <ActivityRail
            isCollapsed={isRailCollapsed}
            onToggle={toggleRail}
            unreadCount={events.length}
          >
            <ActivityFeed
              events={events}
              isEmpty={isEmpty}
              onHighlightLane={setHighlightedLane}
              density="compact"
              onSendTestEvent={() => void sendTestEvent()}
            />
          </ActivityRail>
        </div>

        {/* Channel strip — pinned to the bottom of the pane. Doubles as
            the first-run CTA: "No channels connected yet · Connect a
            channel". Always visible regardless of view mode. */}
        <div className="shrink-0">
          <ChannelStrip
            channels={channels}
            isLoading={isChannelsLoading}
            partial={channelsPartial}
            onConnect={() => setIsConnectOpen(true)}
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

// ─── Activity rail (collapsible right sidebar) ───────────────────────────────

function ActivityRail({
  isCollapsed,
  onToggle,
  unreadCount,
  children,
}: {
  isCollapsed: boolean;
  onToggle: () => void;
  unreadCount: number;
  children: React.ReactNode;
}) {
  if (isCollapsed) {
    // Thin vertical strip — vertical "Activity" label + count chip.
    return (
      <button
        type="button"
        onClick={onToggle}
        aria-label={`Show activity rail · ${unreadCount} events`}
        className="
          group relative flex h-full w-9 shrink-0 flex-col items-center
          justify-between rounded-lg
          bg-foreground/[0.04] border border-foreground/[0.08]
          py-3
          transition-colors duration-150
          hover:bg-foreground/[0.07] hover:border-foreground/[0.14]
          focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40
        "
      >
        <PanelRightOpen
          className="h-4 w-4 text-foreground/65 group-hover:text-foreground"
          strokeWidth={1.8}
        />
        <span
          className="
            font-medium text-[11px] tracking-[0.18em] uppercase
            text-foreground/65 group-hover:text-foreground/85
            [writing-mode:vertical-rl] [text-orientation:mixed]
            select-none
          "
        >
          Activity
        </span>
        <Chip size="sm" radius="full" variant="flat" className="text-[10.5px]">
          {unreadCount}
        </Chip>
      </button>
    );
  }

  return (
    <aside
      className="
        relative flex h-full w-full max-w-[340px] flex-col shrink-0
        rounded-lg
        bg-foreground/[0.04] border border-foreground/[0.08]
      "
    >
      <header className="flex shrink-0 items-center justify-between gap-2 px-3 pt-2.5 pb-1.5 border-b border-foreground/[0.06]">
        <div className="flex items-center gap-1.5">
          <Activity className="h-3.5 w-3.5 text-foreground/65" strokeWidth={2.2} />
          <span className="text-[12px] font-medium text-foreground">
            Activity
          </span>
          <span className="text-[11px] text-foreground/55 tabular-nums">
            {unreadCount}
          </span>
        </div>
        <Button
          isIconOnly
          variant="light"
          size="sm"
          radius="full"
          aria-label="Collapse activity rail"
          onPress={onToggle}
          className="text-foreground/55 hover:text-foreground -mr-1"
        >
          <PanelRightClose className="h-3.5 w-3.5" />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-hidden p-2">
        {children}
      </div>
    </aside>
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

