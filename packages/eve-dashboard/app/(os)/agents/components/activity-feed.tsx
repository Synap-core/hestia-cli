"use client";

/**
 * `ActivityFeed` — chronological event list with three filter dimensions:
 *
 *   • Actor       — who emitted (chips, derived from registry)
 *   • Event type  — narrow to a specific event name
 *   • Outcome     — "all" / "errors only"
 *
 * Renders denser than the previous TimelineView: plain `<ul>` with
 * `<li>` rows instead of `<Card>`-per-event. At 200 buffered events,
 * this drops wrapper count from O(n) Cards to O(1) container.
 *
 * Privacy default: message excerpts hidden behind the eye toggle. The
 * setting persists in localStorage so power users opt in once.
 *
 * Interaction: clicking a row calls `onHighlightLane({from, to})` with
 * the lane that event animates on the graph above. The graph picks up
 * the cross-reference and brightens the corresponding edge for ~1.5s.
 *
 * See: synap-team-docs/content/team/platform/eve-agents-design.mdx §M2
 */

import { useEffect, useMemo, useState } from "react";
import { Button, Chip } from "@heroui/react";
import {
  Eye, EyeOff, MessageSquare, Send, Wrench, Play, Check, X,
  AlertTriangle, Beaker,
  type LucideIcon,
} from "lucide-react";
import {
  type AgentEvent,
  type EventName,
  EVENT_NAMES,
  excerptFor,
} from "../lib/event-types";
import {
  type AgentId,
  type Lane,
  brandFor,
  getAgent,
  laneForEvent,
  originatorOfEvent,
  primaryAgents,
} from "../lib/agent-registry";
import { fallbackBrandColor } from "../../lib/brand-colors";

// ─── Per-event presentation ─────────────────────────────────────────────────

const EVENT_GLYPH: Record<EventName, LucideIcon> = {
  "openclaw:message:received": MessageSquare,
  "synap:reply:routed":        Send,
  "hermes:task:queued":        Wrench,
  "hermes:task:started":       Play,
  "hermes:task:completed":     Check,
  "hermes:task:failed":        X,
};

const EVENT_LABEL: Record<EventName, string> = {
  "openclaw:message:received": "Message received",
  "synap:reply:routed":        "Reply routed",
  "hermes:task:queued":        "Task queued",
  "hermes:task:started":       "Task started",
  "hermes:task:completed":     "Task completed",
  "hermes:task:failed":        "Task failed",
};

// ─── Props ──────────────────────────────────────────────────────────────────

export interface ActivityFeedProps {
  events: AgentEvent[];
  /** Hint that the upstream stream is empty (vs. filter-empty). */
  isEmpty?: boolean;
  /** Called when the user clicks a row. The graph highlights the lane. */
  onHighlightLane?: (lane: Lane | null) => void;
  /**
   * `compact` (default) — dense rows, no day grouping. Rendered alongside
   * the graph in the standard view.
   *
   * `timeline` — group rows by day with sticky headers and roomier
   * spacing. Used when the graph is hidden (Timeline view toggle).
   */
  density?: "compact" | "timeline";
  /**
   * Optional CTA shown in the empty state — wires the "Send a test
   * event" affordance through to the upstream realtime hook so the
   * graph + feed light up without needing a real channel.
   */
  onSendTestEvent?: () => void;
}

type ActorFilter = AgentId | "all";
type OutcomeFilter = "all" | "errors";

const EXCERPT_PREF_KEY = "eve.agents.activityFeed.showExcerpts";
const ACTOR_FILTER_PREF_KEY = "eve.agents.activityFeed.actor";
const OUTCOME_FILTER_PREF_KEY = "eve.agents.activityFeed.outcome";

export function ActivityFeed({
  events,
  isEmpty,
  onHighlightLane,
  density = "compact",
  onSendTestEvent,
}: ActivityFeedProps) {
  const isTimeline = density === "timeline";
  const [actorFilter, setActorFilter] = useState<ActorFilter>("all");
  const [outcomeFilter, setOutcomeFilter] = useState<OutcomeFilter>("all");
  const [showExcerpts, setShowExcerpts] = useState(false);

  // Hydrate persisted prefs once. Plain localStorage — no SSR concern
  // because this whole component is `"use client"` and renders post-mount.
  useEffect(() => {
    try {
      setShowExcerpts(localStorage.getItem(EXCERPT_PREF_KEY) === "1");
      const a = localStorage.getItem(ACTOR_FILTER_PREF_KEY);
      if (a) setActorFilter(a as ActorFilter);
      const o = localStorage.getItem(OUTCOME_FILTER_PREF_KEY);
      if (o === "errors") setOutcomeFilter("errors");
    } catch {
      // localStorage disabled — accept defaults silently.
    }
  }, []);

  const filtered = useMemo(() => {
    return events.filter((evt) => {
      if (outcomeFilter === "errors" && !evt.name.endsWith(":failed")) {
        return false;
      }
      if (actorFilter === "all") return true;
      return originatorOfEvent(evt.name) === actorFilter;
    });
  }, [events, actorFilter, outcomeFilter]);

  const counts = useMemo(() => {
    const out = new Map<AgentId, number>();
    for (const evt of events) {
      const id = originatorOfEvent(evt.name);
      out.set(id, (out.get(id) ?? 0) + 1);
    }
    return out;
  }, [events]);

  const errorCount = useMemo(
    () => events.filter((e) => e.name.endsWith(":failed")).length,
    [events],
  );

  const updateActorFilter = (next: ActorFilter) => {
    setActorFilter(next);
    try { localStorage.setItem(ACTOR_FILTER_PREF_KEY, next); } catch { /* noop */ }
  };
  const updateOutcomeFilter = (next: OutcomeFilter) => {
    setOutcomeFilter(next);
    try { localStorage.setItem(OUTCOME_FILTER_PREF_KEY, next); } catch { /* noop */ }
  };
  const toggleExcerpts = () => {
    setShowExcerpts((prev) => {
      const next = !prev;
      try { localStorage.setItem(EXCERPT_PREF_KEY, next ? "1" : "0"); } catch { /* noop */ }
      return next;
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* Filters row */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <div className="flex items-center gap-1.5 overflow-x-auto">
          <ActorChip
            label="All"
            count={events.length}
            active={actorFilter === "all"}
            onPress={() => updateActorFilter("all")}
          />
          {primaryAgents().map((agent) => (
            <ActorChip
              key={agent.id}
              label={agent.label}
              count={counts.get(agent.id) ?? 0}
              active={actorFilter === agent.id}
              accent={brandFor(agent).accent}
              onPress={() => updateActorFilter(agent.id)}
            />
          ))}

          <span
            className="mx-1 h-4 w-px shrink-0 bg-foreground/[0.10]"
            aria-hidden
          />

          <Chip
            size="sm"
            radius="full"
            variant={outcomeFilter === "errors" ? "solid" : "flat"}
            color={outcomeFilter === "errors" ? "danger" : "default"}
            startContent={
              <AlertTriangle className="ml-1 h-3 w-3" strokeWidth={2.2} />
            }
            onClick={() =>
              updateOutcomeFilter(outcomeFilter === "errors" ? "all" : "errors")
            }
            className="cursor-pointer"
          >
            <span className="text-[12px]">
              Errors{" "}
              <span
                className={
                  outcomeFilter === "errors"
                    ? "text-white/65"
                    : "text-foreground/55"
                }
              >
                {errorCount}
              </span>
            </span>
          </Chip>
        </div>

        <Button
          isIconOnly
          variant="light"
          size="sm"
          radius="full"
          aria-label={showExcerpts ? "Hide message excerpts" : "Show message excerpts"}
          onPress={toggleExcerpts}
          className="text-foreground/55 hover:text-foreground"
        >
          {showExcerpts ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
        </Button>
      </div>

      {/* Rows */}
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {filtered.length === 0 ? (
          <EmptyFeed
            isEmpty={Boolean(isEmpty)}
            hasFilter={actorFilter !== "all" || outcomeFilter !== "all"}
            onSendTestEvent={onSendTestEvent}
          />
        ) : isTimeline ? (
          <TimelineList
            events={filtered}
            showExcerpts={showExcerpts}
            onHighlightLane={onHighlightLane}
          />
        ) : (
          <ul className="space-y-1">
            {filtered.map((evt) => (
              <ActivityRow
                key={evt.id}
                event={evt}
                showExcerpt={showExcerpts}
                density="compact"
                onClick={() => onHighlightLane?.(laneForEvent(evt.name as EventName))}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ─── Timeline list — day-grouped, roomier rendering ─────────────────────────

const DATE_HEADER_FMT = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "long",
  day: "numeric",
});

function dayKey(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "unknown";
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  const today = new Date();
  if (
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate()
  ) {
    return "Today";
  }
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate()
  ) {
    return "Yesterday";
  }
  return DATE_HEADER_FMT.format(d);
}

function TimelineList({
  events,
  showExcerpts,
  onHighlightLane,
}: {
  events: AgentEvent[];
  showExcerpts: boolean;
  onHighlightLane?: (lane: Lane | null) => void;
}) {
  // Group by day key. Events arrive newest-first from the buffer, so groups
  // come out newest-first naturally — no extra sort needed.
  const groups = useMemo(() => {
    const out: Array<{ key: string; label: string; rows: AgentEvent[] }> = [];
    let current: { key: string; label: string; rows: AgentEvent[] } | null = null;
    for (const evt of events) {
      const k = dayKey(evt.at);
      if (!current || current.key !== k) {
        current = { key: k, label: dayLabel(evt.at), rows: [] };
        out.push(current);
      }
      current.rows.push(evt);
    }
    return out;
  }, [events]);

  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <section key={g.key}>
          <h3
            className="
              sticky top-0 z-10 mb-1 -mx-1 px-1
              bg-content1/85 backdrop-blur-pane
              py-1.5
              text-[10.5px] font-medium uppercase tracking-[0.06em] text-foreground/55
            "
          >
            {g.label}
            <span className="ml-2 text-foreground/40 normal-case tracking-normal">
              {g.rows.length} {g.rows.length === 1 ? "event" : "events"}
            </span>
          </h3>
          <ul className="space-y-1.5">
            {g.rows.map((evt) => (
              <ActivityRow
                key={evt.id}
                event={evt}
                showExcerpt={showExcerpts}
                density="timeline"
                onClick={() => onHighlightLane?.(laneForEvent(evt.name as EventName))}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

// ─── Row ─────────────────────────────────────────────────────────────────────

function ActivityRow({
  event,
  showExcerpt,
  density = "compact",
  onClick,
}: {
  event: AgentEvent;
  showExcerpt: boolean;
  density?: "compact" | "timeline";
  onClick: () => void;
}) {
  const id = originatorOfEvent(event.name);
  const agent = getAgent(id);
  const accent = agent ? brandFor(agent).accent : fallbackBrandColor(id).accent;
  const Glyph = EVENT_GLYPH[event.name as EventName] ?? MessageSquare;
  const label = EVENT_LABEL[event.name as EventName] ?? event.name;
  const isFailure = event.name.endsWith(":failed");
  const excerpt = excerptFor(event.name as EventName, event.payload);
  const relative = formatRelative(event.at);
  const absolute = formatAbsolute(event.at);
  const isTimeline = density === "timeline";

  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        title={absolute}
        className={
          "group relative flex w-full items-start gap-3 rounded-md text-left " +
          "transition-colors duration-150 " +
          "hover:bg-foreground/[0.05] " +
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 " +
          (isTimeline ? "px-3 py-3" : "px-2.5 py-2")
        }
      >
        {/* Left edge accent — actor brand color, sized by row height */}
        <span
          className={
            "absolute left-0 w-[2px] rounded-full " +
            (isTimeline ? "top-3 bottom-3" : "top-2 bottom-2")
          }
          style={{ background: accent }}
          aria-hidden
        />

        {/* Glyph chip — small, brand-tinted. Larger in timeline mode. */}
        <span
          className={
            "mt-0.5 inline-flex shrink-0 items-center justify-center rounded-full " +
            (isTimeline ? "h-7 w-7" : "h-5 w-5")
          }
          style={{ background: `${accent}26`, color: accent }}
          aria-hidden
        >
          <Glyph
            className={isTimeline ? "h-3.5 w-3.5" : "h-3 w-3"}
            strokeWidth={2.2}
          />
        </span>

        {/* Body */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className={
                "font-medium text-foreground truncate " +
                (isTimeline ? "text-[13.5px]" : "text-[12.5px]")
              }
            >
              {label}
            </span>
            <span
              className={
                "text-foreground/55 truncate " +
                (isTimeline ? "text-[11.5px]" : "text-[11px]")
              }
            >
              {agent?.label ?? id}
            </span>
          </div>
          {showExcerpt && excerpt && (
            <p
              className={
                "mt-0.5 truncate " +
                (isTimeline ? "text-[12px]" : "text-[11.5px]") +
                " " +
                (isFailure ? "text-danger" : "text-foreground/55")
              }
              title={excerpt}
            >
              {excerpt}
            </p>
          )}
        </div>

        {/* Right rail — relative time. Absolute revealed via title=. */}
        <span
          className={
            "shrink-0 tabular-nums text-foreground/55 " +
            (isTimeline ? "text-[11.5px]" : "text-[11px]")
          }
        >
          {relative}
        </span>
      </button>
    </li>
  );
}

// ─── Empty state ─────────────────────────────────────────────────────────────

function EmptyFeed({
  isEmpty,
  hasFilter,
  onSendTestEvent,
}: {
  isEmpty: boolean;
  hasFilter: boolean;
  onSendTestEvent?: () => void;
}) {
  const showCta = !hasFilter && Boolean(onSendTestEvent);
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
      <p className="text-[13px] text-foreground/65">
        {hasFilter
          ? "No events match this filter yet."
          : isEmpty
            ? "Listening for events…"
            : "No events recorded."}
      </p>
      <p className="text-[11px] text-foreground/55">
        Events appear here the moment any agent does anything.
      </p>
      {showCta && (
        <Button
          size="sm"
          radius="full"
          variant="flat"
          startContent={<Beaker className="h-3.5 w-3.5" />}
          onPress={onSendTestEvent}
          className="mt-2 text-foreground/85"
        >
          Send a test event
        </Button>
      )}
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function ActorChip({
  label,
  count,
  active,
  accent,
  onPress,
}: {
  label: string;
  count: number;
  active: boolean;
  accent?: string;
  onPress: () => void;
}) {
  return (
    <Chip
      size="sm"
      radius="full"
      variant={active ? "solid" : "flat"}
      color={active ? "primary" : "default"}
      onClick={onPress}
      className="cursor-pointer"
      startContent={
        accent ? (
          <span
            className="ml-1 h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ background: accent }}
            aria-hidden
          />
        ) : null
      }
    >
      <span className="text-[12px]">
        {label}{" "}
        <span className={active ? "text-white/65" : "text-foreground/55"}>
          {count}
        </span>
      </span>
    </Chip>
  );
}

const RTF = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

function formatRelative(iso: string): string {
  const d = new Date(iso).getTime();
  if (!Number.isFinite(d)) return "";
  const deltaMs = d - Date.now();
  const seconds = Math.round(deltaMs / 1000);
  if (Math.abs(seconds) < 45) return RTF.format(seconds, "second");
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return RTF.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return RTF.format(hours, "hour");
  const days = Math.round(hours / 24);
  return RTF.format(days, "day");
}

function formatAbsolute(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

// Suppress unused warning — re-exported for downstream filter pickers.
export { EVENT_NAMES };
