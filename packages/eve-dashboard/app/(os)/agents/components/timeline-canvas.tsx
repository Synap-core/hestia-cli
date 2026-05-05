"use client";

/**
 * `TimelineCanvas` — horizontal swimlane view of the event chain.
 *
 * One row per agent. The X axis is time (newest on the right). Every
 * event is a colored marker on its agent's lane, plotted at its actual
 * timestamp. Causal chains — `openclaw:received` → `synap:routed` →
 * `hermes:queued` → `:started` → `:completed` — are drawn as soft
 * curves between markers, so the eye can trace a single conversation
 * across the fleet at a glance.
 *
 * What this gives you that the list view can't:
 *   • Bursts: a flurry of events from a single agent shows as a dense
 *     cluster, not 30 indistinguishable list rows.
 *   • Concurrency: two agents working at the same time read as parallel
 *     marker columns, revealing race conditions and bottlenecks.
 *   • Causality: the curves tie a request to its eventual reply or
 *     failure, so the chain is visible without re-reading payloads.
 *
 * Interaction:
 *   • Hover a marker — popover with the event name + payload excerpt
 *   • Click a marker — surface the causal chain it belongs to (others
 *     dim to 0.25; the chain stays full-opacity)
 *   • Click an agent label on the left — open the side panel for that
 *     agent (same `onSelectAgent` contract as the graph)
 *
 * Renders inline SVG — no extra dependency. Performance: marker cap of
 * 200 (the default buffer size) means we render ~6 lanes × ~30 markers
 * = ~200 elements. Below the threshold where Canvas would beat SVG.
 *
 * See: synap-team-docs/content/team/platform/eve-agents-design.mdx §M3
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@heroui/react";
import { Beaker, Locate } from "lucide-react";
import {
  type AgentId,
  type AgentStatusSnapshot,
  brandFor,
  getAgent,
  laneForEvent,
  originatorOfEvent,
  primaryAgents,
} from "../lib/agent-registry";
import {
  type AgentEvent,
  type EventName,
  excerptFor,
} from "../lib/event-types";

// ─── Layout constants ────────────────────────────────────────────────────────

const LANE_HEIGHT = 56;
const LABEL_W = 120;
const RIGHT_PAD = 16;
const TOP_PAD = 28;
const BOTTOM_PAD = 24;
const MARKER_R = 6;
const MARKER_R_HOVER = 9;

// Default time window when there's no data, or a single event. The window
// extends from `now - WINDOW_MS` to `now`, plus a 5% padding on each side.
const WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const X_PAD = 0.04;

// User-controlled viewport — drag-to-pan + wheel-zoom. The viewport is
// expressed as a span in ms (zoom) plus an offset in ms relative to
// "now" (pan). When the offset is 0 the right edge of the chart is the
// present moment ("live"); a positive offset means the viewport is
// shifted into the past (right edge = now - offset).
//
// Zoom span is clamped: at most 24h back, at least 30s.
const ZOOM_MIN_MS = 30_000;          // 30s — drill into a burst
const ZOOM_MAX_MS = 24 * 60 * 60 * 1000; // 24h — overview
const PAN_MAX_MS = 24 * 60 * 60 * 1000;  // can't pan further back than 24h

// ─── Public API ──────────────────────────────────────────────────────────────

export interface TimelineCanvasProps {
  events: AgentEvent[];
  agentStatuses: Record<AgentId, AgentStatusSnapshot>;
  isEmpty: boolean;
  onSelectAgent: (id: AgentId | null) => void;
  onSendTestEvent?: () => void;
}

export function TimelineCanvas({
  events,
  agentStatuses,
  isEmpty,
  onSelectAgent,
  onSendTestEvent,
}: TimelineCanvasProps) {
  const [activeChain, setActiveChain] = useState<Set<string> | null>(null);
  const [hoverEventId, setHoverEventId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [width, setWidth] = useState(0);

  // Viewport state — span (zoom) + offset (pan). Default: 5min span,
  // anchored to "now" (offset 0). Updated by drag + wheel handlers.
  const [zoomMs, setZoomMs] = useState<number>(WINDOW_MS);
  const [offsetMs, setOffsetMs] = useState<number>(0);
  const isLive = offsetMs === 0;

  // Observe container width so the time axis scales fluidly. SVG handles
  // its own height via the lane count.
  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Lanes: brain on top, then primaries (no subagents — keeps the chart
  // clean; subagents collapse into their parent's lane and inherit the
  // glyph color).
  const lanes = useMemo(() => {
    const synap = getAgent("synap");
    const out = synap ? [synap] : [];
    out.push(...primaryAgents().filter((a) => a.id !== "synap"));
    return out;
  }, []);

  // Map every event to its lane (root agent — subagents roll up).
  const eventsByLane = useMemo(() => {
    const out = new Map<AgentId, AgentEvent[]>();
    for (const lane of lanes) out.set(lane.id, []);
    for (const evt of events) {
      const id = originatorOfEvent(evt.name);
      const root = id.includes(".")
        ? (id.split(".")[0] as AgentId)
        : id;
      const list = out.get(root);
      if (list) list.push(evt);
    }
    return out;
  }, [events, lanes]);

  // Time window — driven by user pan/zoom state. When offset = 0 the
  // viewport's right edge tracks `now`; otherwise it sits in the past.
  // We tick `now` once per second so the live edge advances when the
  // user is in live mode.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!isLive) return; // freeze when panned into the past
    const i = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(i);
  }, [isLive]);

  const timeMax = now - offsetMs;
  const timeMin = timeMax - zoomMs;
  const timeSpan = Math.max(zoomMs, 30_000);

  const innerHeight = TOP_PAD + lanes.length * LANE_HEIGHT + BOTTOM_PAD;
  const plotW = Math.max(width - LABEL_W - RIGHT_PAD, 200);

  function xFor(ts: number): number {
    const t = (ts - timeMin) / timeSpan;
    const padded = X_PAD + t * (1 - 2 * X_PAD);
    return LABEL_W + padded * plotW;
  }
  function yFor(laneIdx: number): number {
    return TOP_PAD + laneIdx * LANE_HEIGHT + LANE_HEIGHT / 2;
  }

  // Pixel ↔ time conversions for drag/zoom math.
  const msPerPixel = timeSpan / Math.max(plotW * (1 - 2 * X_PAD), 1);

  // ── Drag-to-pan ───────────────────────────────────────────────────────────
  const dragRef = useRef<{ startX: number; startOffset: number } | null>(null);
  const onPointerDown = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      // Don't start a pan if the user is clicking a marker or label —
      // those have their own click handlers and stop propagation.
      if ((e.target as Element).closest("[data-no-pan='1']")) return;
      dragRef.current = { startX: e.clientX, startOffset: offsetMs };
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    },
    [offsetMs],
  );
  const onPointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = e.clientX - drag.startX;
      // Drag right (positive dx) → reveal more past (offset increases).
      const next = Math.max(
        0,
        Math.min(PAN_MAX_MS, drag.startOffset + dx * msPerPixel),
      );
      setOffsetMs(next);
    },
    [msPerPixel],
  );
  const onPointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  // ── Wheel-to-zoom ─────────────────────────────────────────────────────────
  const onWheel = useCallback(
    (e: React.WheelEvent<SVGSVGElement>) => {
      // Only handle when the user is actively wheeling on the canvas.
      // Page-scroll wheels with deltaY < 0 / > 0 should NOT zoom unless
      // the cursor is over the SVG. React passes onWheel only when the
      // cursor is over us, so we're already in scope.
      e.preventDefault();
      const factor = e.deltaY < 0 ? 0.85 : 1.18;
      setZoomMs((prev) => {
        const next = Math.max(
          ZOOM_MIN_MS,
          Math.min(ZOOM_MAX_MS, prev * factor),
        );
        return next;
      });
    },
    [],
  );

  const resetToLive = useCallback(() => {
    setOffsetMs(0);
    setZoomMs(WINDOW_MS);
  }, []);

  // Causal chains — one chain per "root request". We bucket consecutive
  // events that share a `taskId` or fall within 8s of each other into a
  // single chain. Cheap, and good enough for visual storytelling.
  const chains = useMemo(() => {
    return computeChains(events);
  }, [events]);

  const eventToChain = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of chains) {
      for (const id of c.eventIds) m.set(id, c.id);
    }
    return m;
  }, [chains]);

  function isVisible(eventId: string): boolean {
    if (!activeChain) return true;
    return activeChain.has(eventId);
  }

  // ── Time axis ticks — adaptive interval based on zoom span ────────────────
  // Span dictates tick granularity: 30s → tick every 5s; 5min → 1min;
  // 1h → 10min; 24h → 1h. Keeps the axis legible at any zoom level.
  const ticks = useMemo(() => {
    const out: { x: number; label: string }[] = [];
    const tickStep = chooseTickStep(timeSpan);
    const startTick = Math.ceil(timeMin / tickStep) * tickStep;
    for (let t = startTick; t <= timeMax; t += tickStep) {
      out.push({ x: xFor(t), label: relativeAt(t, now) });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeMin, timeMax, timeSpan, plotW]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* Header — chain count + viewport controls. Reset button surfaces
          when the viewport has been panned away from "now" or zoomed
          beyond the default span. */}
      <div className="flex items-center justify-between gap-2 px-1">
        <div className="flex items-center gap-2">
          <span className="text-[12.5px] font-medium text-foreground">
            Timeline
          </span>
          <span className="text-[11.5px] text-foreground/55 tabular-nums">
            {events.length} {events.length === 1 ? "event" : "events"}
            {chains.length > 0 ? ` · ${chains.length} chain${chains.length === 1 ? "" : "s"}` : ""}
            {!isLive && ` · ${formatSpanShort(zoomMs)} window`}
          </span>
          {!isLive && (
            <span className="text-[10.5px] uppercase tracking-[0.06em] text-foreground/55 px-1.5 py-[1px] rounded bg-foreground/[0.06]">
              paused
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {activeChain && (
            <Button
              size="sm"
              radius="full"
              variant="light"
              onPress={() => setActiveChain(null)}
              className="text-foreground/65 hover:text-foreground"
            >
              Clear filter
            </Button>
          )}
          {!isLive || zoomMs !== WINDOW_MS ? (
            <Button
              size="sm"
              radius="full"
              variant="flat"
              startContent={<Locate className="h-3 w-3" />}
              onPress={resetToLive}
              className="text-foreground/85"
            >
              Live
            </Button>
          ) : (
            <span className="inline-flex items-center gap-1 text-[11px] text-success px-1">
              <span
                className="h-1.5 w-1.5 rounded-full bg-success"
                style={{ boxShadow: "0 0 6px rgba(52,211,153,0.7)" }}
                aria-hidden
              />
              Live
            </span>
          )}
        </div>
      </div>

      <div
        ref={containerRef}
        className="
          relative min-h-0 flex-1 overflow-y-auto rounded-lg
          bg-foreground/[0.03] border border-foreground/[0.06]
        "
      >
        {isEmpty ? (
          <EmptyTimeline onSendTestEvent={onSendTestEvent} />
        ) : width > 0 ? (
          <svg
            ref={svgRef}
            width="100%"
            height={innerHeight}
            viewBox={`0 0 ${width} ${innerHeight}`}
            className="block touch-none select-none"
            style={{ cursor: dragRef.current ? "grabbing" : "grab" }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onPointerLeave={onPointerUp}
            onWheel={onWheel}
          >
            {/* Lane backgrounds + labels */}
            {lanes.map((agent, i) => {
              const y = TOP_PAD + i * LANE_HEIGHT;
              const brand = brandFor(agent);
              const status = agentStatuses[agent.id]?.status ?? "idle";
              return (
                <g key={agent.id}>
                  <rect
                    x={LABEL_W - 8}
                    y={y + 6}
                    width={width - LABEL_W - RIGHT_PAD + 8}
                    height={LANE_HEIGHT - 12}
                    rx={6}
                    fill={i % 2 === 0 ? "rgba(255,255,255,0.015)" : "transparent"}
                  />
                  <line
                    x1={LABEL_W}
                    y1={yFor(i)}
                    x2={width - RIGHT_PAD}
                    y2={yFor(i)}
                    stroke="rgba(255,255,255,0.04)"
                    strokeDasharray="2,4"
                  />
                  <foreignObject
                    x={6}
                    y={yFor(i) - 16}
                    width={LABEL_W - 12}
                    height={32}
                    data-no-pan="1"
                  >
                    <button
                      type="button"
                      data-no-pan="1"
                      onClick={() => onSelectAgent(agent.id)}
                      className="
                        flex h-full w-full items-center gap-2 rounded-md px-2
                        text-left
                        hover:bg-foreground/[0.04]
                        focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40
                      "
                    >
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{
                          background: brand.accent,
                          opacity: status === "idle" ? 0.4 : 1,
                          boxShadow:
                            status === "active"
                              ? `0 0 6px ${brand.accent}aa`
                              : undefined,
                        }}
                        aria-hidden
                      />
                      <span className="text-[11.5px] font-medium text-foreground/85 truncate">
                        {agent.label}
                      </span>
                    </button>
                  </foreignObject>
                </g>
              );
            })}

            {/* Time axis ticks */}
            {ticks.map((t, i) => (
              <g key={`tick-${i}`}>
                <line
                  x1={t.x}
                  y1={TOP_PAD - 6}
                  x2={t.x}
                  y2={innerHeight - BOTTOM_PAD + 6}
                  stroke="rgba(255,255,255,0.04)"
                />
                <text
                  x={t.x}
                  y={TOP_PAD - 10}
                  textAnchor="middle"
                  className="fill-foreground/45 text-[10px] tabular-nums"
                  style={{ fontFamily: "inherit" }}
                >
                  {t.label}
                </text>
              </g>
            ))}

            {/* "Now" line — only renders when the viewport actually
                reaches present time (i.e. live mode, not panned into
                the past). */}
            {now >= timeMin && now <= timeMax + zoomMs * 0.04 && (
              <>
                <line
                  x1={xFor(now)}
                  y1={TOP_PAD - 8}
                  x2={xFor(now)}
                  y2={innerHeight - BOTTOM_PAD + 8}
                  stroke="rgba(52, 211, 153, 0.55)"
                  strokeWidth={1.2}
                />
                <text
                  x={xFor(now)}
                  y={TOP_PAD - 12}
                  textAnchor="end"
                  className="fill-success text-[10px] tabular-nums"
                  style={{ fontFamily: "inherit" }}
                >
                  now
                </text>
              </>
            )}

            {/* Causal chain curves — drawn beneath markers */}
            {chains.map((chain) => {
              if (chain.eventIds.length < 2) return null;
              const points: { x: number; y: number; id: string }[] = [];
              for (const id of chain.eventIds) {
                const evt = events.find((e) => e.id === id);
                if (!evt) continue;
                const ts = Date.parse(evt.at);
                if (!Number.isFinite(ts)) continue;
                const root = rootAgentForEvent(evt);
                const laneIdx = lanes.findIndex((a) => a.id === root);
                if (laneIdx < 0) continue;
                points.push({ x: xFor(ts), y: yFor(laneIdx), id });
              }
              if (points.length < 2) return null;
              const pathD = points
                .map((p, i) => {
                  if (i === 0) return `M ${p.x} ${p.y}`;
                  const prev = points[i - 1];
                  const cx = (prev.x + p.x) / 2;
                  return `C ${cx} ${prev.y}, ${cx} ${p.y}, ${p.x} ${p.y}`;
                })
                .join(" ");
              const isActive = activeChain && activeChain.has(points[0].id);
              const opacity = activeChain
                ? isActive
                  ? 0.85
                  : 0.08
                : 0.32;
              return (
                <path
                  key={chain.id}
                  d={pathD}
                  fill="none"
                  stroke={chain.accent}
                  strokeWidth={isActive ? 2 : 1.2}
                  opacity={opacity}
                  strokeLinecap="round"
                  style={{ transition: "opacity 200ms, stroke-width 200ms" }}
                />
              );
            })}

            {/* Markers */}
            {lanes.map((agent, laneIdx) => {
              const list = eventsByLane.get(agent.id) ?? [];
              return list.map((evt) => {
                const ts = Date.parse(evt.at);
                if (!Number.isFinite(ts)) return null;
                const x = xFor(ts);
                const y = yFor(laneIdx);
                const brand = brandFor(agent);
                const isFailure = evt.name.endsWith(":failed");
                const isHover = hoverEventId === evt.id;
                const visible = isVisible(evt.id);
                const fill = isFailure ? "var(--colors-danger)" : brand.accent;
                return (
                  <g
                    key={evt.id}
                    data-no-pan="1"
                    style={{
                      cursor: "pointer",
                      transition: "opacity 200ms",
                      opacity: visible ? 1 : 0.18,
                    }}
                    onMouseEnter={() => setHoverEventId(evt.id)}
                    onMouseLeave={() => setHoverEventId(null)}
                    onClick={(e) => {
                      e.stopPropagation();
                      const chainId = eventToChain.get(evt.id);
                      const chain = chains.find((c) => c.id === chainId);
                      if (chain) {
                        setActiveChain(new Set(chain.eventIds));
                      } else {
                        setActiveChain(new Set([evt.id]));
                      }
                    }}
                  >
                    <circle
                      cx={x}
                      cy={y}
                      r={isHover ? MARKER_R_HOVER : MARKER_R}
                      fill={fill}
                      opacity={0.9}
                      style={{ transition: "r 160ms ease-out" }}
                    />
                    <circle
                      cx={x}
                      cy={y}
                      r={isHover ? MARKER_R_HOVER + 4 : MARKER_R + 3}
                      fill="none"
                      stroke={fill}
                      strokeWidth={1}
                      opacity={isHover ? 0.4 : 0.18}
                    />
                  </g>
                );
              });
            })}

            {/* Hover popover */}
            {hoverEventId &&
              (() => {
                const evt = events.find((e) => e.id === hoverEventId);
                if (!evt) return null;
                const ts = Date.parse(evt.at);
                if (!Number.isFinite(ts)) return null;
                const root = rootAgentForEvent(evt);
                const laneIdx = lanes.findIndex((a) => a.id === root);
                if (laneIdx < 0) return null;
                const x = xFor(ts);
                const y = yFor(laneIdx);
                const excerpt = excerptFor(
                  evt.name as EventName,
                  evt.payload,
                );
                const popoverW = 220;
                const popoverH = excerpt ? 56 : 36;
                const popX = Math.min(x + 12, width - RIGHT_PAD - popoverW);
                const popY = Math.max(TOP_PAD, y - popoverH - 12);
                return (
                  <foreignObject
                    x={popX}
                    y={popY}
                    width={popoverW}
                    height={popoverH}
                    style={{ pointerEvents: "none" }}
                  >
                    <div
                      className="
                        flex h-full flex-col gap-0.5 rounded-md px-2.5 py-1.5
                        bg-content1/95 backdrop-blur-pane border border-foreground/[0.10]
                      "
                    >
                      <p className="text-[11px] font-mono text-foreground truncate">
                        {evt.name}
                      </p>
                      {excerpt && (
                        <p className="text-[10.5px] text-foreground/65 truncate">
                          {excerpt}
                        </p>
                      )}
                    </div>
                  </foreignObject>
                );
              })()}
          </svg>
        ) : null}
      </div>
    </div>
  );
}

// ─── Empty state ─────────────────────────────────────────────────────────────

function EmptyTimeline({ onSendTestEvent }: { onSendTestEvent?: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 py-20 text-center">
      <p className="text-[13px] text-foreground/65">
        No events yet. The timeline lights up the moment any agent moves.
      </p>
      {onSendTestEvent && (
        <Button
          size="sm"
          radius="full"
          variant="flat"
          startContent={<Beaker className="h-3.5 w-3.5" />}
          onPress={onSendTestEvent}
          className="text-foreground/85"
        >
          Send a test event
        </Button>
      )}
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface CausalChain {
  id: string;
  eventIds: string[];
  accent: string;
}

/**
 * Bucket events into causal chains. Strategy:
 *   1. Events with the same `taskId` belong to the same chain.
 *   2. Otherwise, an `openclaw:received` followed within 8s by a
 *      `synap:reply:routed` joins them.
 *   3. Then any `hermes:task:*` within 30s after a `synap` event with
 *      the same channel/message context is folded in.
 *
 * Cheap, single-pass. Good enough for visual storytelling — not a
 * formal trace correlation. Backend trace ID would supersede this.
 */
function computeChains(events: AgentEvent[]): CausalChain[] {
  // Sort by time ascending — events buffer is newest-first, so reverse.
  const sorted = [...events].sort(
    (a, b) => Date.parse(a.at) - Date.parse(b.at),
  );

  const byTaskId = new Map<string, string[]>();
  const chronological: AgentEvent[] = [];
  const taskIdFor = (evt: AgentEvent): string | null => {
    const obj = (evt.payload ?? {}) as Record<string, unknown>;
    const id = obj.taskId;
    return typeof id === "string" ? id : null;
  };
  const messageIdFor = (evt: AgentEvent): string | null => {
    const obj = (evt.payload ?? {}) as Record<string, unknown>;
    const id = obj.messageId;
    return typeof id === "string" ? id : null;
  };

  for (const evt of sorted) {
    const tid = taskIdFor(evt);
    if (tid) {
      const list = byTaskId.get(tid) ?? [];
      list.push(evt.id);
      byTaskId.set(tid, list);
      continue;
    }
    chronological.push(evt);
  }

  const chains: CausalChain[] = [];

  // Task-correlated chains.
  for (const [tid, ids] of byTaskId) {
    const first = sorted.find((e) => e.id === ids[0]);
    if (!first) continue;
    chains.push({
      id: `task-${tid}`,
      eventIds: ids,
      accent: accentForEventName(first.name),
    });
  }

  // Message-correlated chains (received → routed).
  const usedIds = new Set<string>();
  for (let i = 0; i < chronological.length; i++) {
    const evt = chronological[i];
    if (usedIds.has(evt.id)) continue;
    if (evt.name !== "openclaw:message:received") continue;
    const mid = messageIdFor(evt);
    if (!mid) continue;
    const reply = chronological.find(
      (other) =>
        other.name === "synap:reply:routed" &&
        messageIdFor(other) === mid &&
        !usedIds.has(other.id),
    );
    if (reply) {
      usedIds.add(evt.id);
      usedIds.add(reply.id);
      chains.push({
        id: `msg-${mid}`,
        eventIds: [evt.id, reply.id],
        accent: accentForEventName(evt.name),
      });
    }
  }

  return chains;
}

function accentForEventName(name: string): string {
  const root = name.split(":")[0] as AgentId;
  const agent = getAgent(root);
  if (agent) return brandFor(agent).accent;
  return "rgba(180,180,180,0.6)";
}

function rootAgentForEvent(evt: AgentEvent): AgentId {
  const id = originatorOfEvent(evt.name);
  return id.includes(".") ? (id.split(".")[0] as AgentId) : id;
}

/**
 * Compact human-readable form of a viewport span — used in the
 * paused-state header chip ("paused · 12m window").
 */
function formatSpanShort(ms: number): string {
  if (ms < 90_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 90 * 60_000) return `${Math.round(ms / 60_000)}m`;
  return `${Math.round(ms / (60 * 60_000))}h`;
}

/**
 * Pick a tick interval (in ms) appropriate for the given viewport span.
 * Aims for 5–8 ticks across the canvas at any zoom level.
 */
function chooseTickStep(spanMs: number): number {
  if (spanMs <= 60_000) return 10_000;            // 10s ticks for ≤ 1min
  if (spanMs <= 5 * 60_000) return 60_000;        // 1min for ≤ 5min
  if (spanMs <= 30 * 60_000) return 5 * 60_000;   // 5min for ≤ 30min
  if (spanMs <= 60 * 60_000) return 10 * 60_000;  // 10min for ≤ 1h
  if (spanMs <= 6 * 60 * 60_000) return 60 * 60_000; // 1h for ≤ 6h
  return 6 * 60 * 60_000;                         // 6h for everything bigger
}

function relativeAt(ts: number, now: number): string {
  const delta = Math.round((ts - now) / 1000);
  if (Math.abs(delta) < 5) return "now";
  if (delta < 0) {
    const m = Math.round(-delta / 60);
    if (m === 0) return `${-delta}s ago`;
    if (m === 1) return "1m ago";
    if (m < 60) return `${m}m ago`;
    return `${Math.round(m / 60)}h ago`;
  }
  return "+" + delta + "s";
}
// Use the lane registry — silenced unused import otherwise.
void laneForEvent;
