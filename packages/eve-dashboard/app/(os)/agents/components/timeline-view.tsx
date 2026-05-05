"use client";

/**
 * `TimelineView` — chronological list of every event that flowed through
 * the agentic triangle (OpenClaw ↔ Synap ↔ Hermes).
 *
 * Filter chips along the top let the operator narrow by event family.
 * The eye-icon button at top-right toggles excerpt visibility — by
 * default message bodies are HIDDEN to respect the "no creepy ambient
 * surveillance" privacy default.
 *
 * Rows render with the actor's brand color as a left edge, the event
 * name in monospace, the relative time on the right, and (when the
 * privacy toggle is ON) the excerpt below.
 *
 * See: synap-team-docs/content/team/platform/eve-agents-design.mdx
 */

import { useMemo, useState } from "react";
import { Card, CardBody, Button, Chip } from "@heroui/react";
import {
  Eye, EyeOff, MessageSquare, Send, Wrench, Play, Check, X,
  type LucideIcon,
} from "lucide-react";
import {
  type AgentEvent,
  type EventName,
  type Actor,
  EVENT_NAMES,
  actorFor,
  excerptFor,
} from "../lib/event-types";

const ACTOR_COLOR: Record<Actor, string> = {
  openclaw: "#A78BFA",   // violet — same as the dock icon
  synap:    "#34D399",   // emerald
  hermes:   "#FBBF24",   // amber
};

const ACTOR_LABEL: Record<Actor, string> = {
  openclaw: "OpenClaw",
  synap:    "Synap",
  hermes:   "Hermes",
};

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

const FILTER_GROUPS: Array<{ key: Actor | "all"; label: string }> = [
  { key: "all",      label: "All" },
  { key: "openclaw", label: "OpenClaw" },
  { key: "synap",    label: "Synap" },
  { key: "hermes",   label: "Hermes" },
];

export interface TimelineViewProps {
  events: AgentEvent[];
  /** Render a "no events yet" surface when the buffer is empty. */
  isEmpty?: boolean;
}

export function TimelineView({ events, isEmpty }: TimelineViewProps) {
  const [filter, setFilter] = useState<Actor | "all">("all");
  const [showExcerpts, setShowExcerpts] = useState(false);

  const filtered = useMemo(() => {
    if (filter === "all") return events;
    return events.filter(e => actorFor(e.name) === filter);
  }, [events, filter]);

  const counts = useMemo(() => {
    const out: Record<Actor, number> = { openclaw: 0, synap: 0, hermes: 0 };
    for (const e of events) out[actorFor(e.name)]++;
    return out;
  }, [events]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* Filter strip + privacy toggle */}
      <div className="flex items-center justify-between gap-3 px-1">
        <div className="flex items-center gap-1.5 overflow-x-auto">
          {FILTER_GROUPS.map(g => {
            const active = filter === g.key;
            const count =
              g.key === "all"
                ? events.length
                : counts[g.key];
            return (
              <Chip
                key={g.key}
                size="sm"
                radius="full"
                variant={active ? "solid" : "flat"}
                color={active ? "primary" : "default"}
                onClick={() => setFilter(g.key)}
                className="cursor-pointer"
              >
                <span className="text-[12px]">
                  {g.label}{" "}
                  <span className={active ? "text-white/70" : "text-foreground/40"}>
                    {count}
                  </span>
                </span>
              </Chip>
            );
          })}
        </div>
        <Button
          isIconOnly
          variant="light"
          size="sm"
          radius="full"
          aria-label={showExcerpts ? "Hide message excerpts" : "Show message excerpts"}
          onPress={() => setShowExcerpts(prev => !prev)}
          className="text-foreground/55 hover:text-foreground"
        >
          {showExcerpts ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
        </Button>
      </div>

      {/* Event rows — scrollable */}
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {filtered.length === 0 ? (
          <EmptyTimeline isEmpty={Boolean(isEmpty)} hasFilter={filter !== "all"} />
        ) : (
          <ul className="space-y-1.5">
            {filtered.map(evt => (
              <TimelineRow key={evt.id} event={evt} showExcerpt={showExcerpts} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ── Row ──────────────────────────────────────────────────────────────────────

function TimelineRow({
  event,
  showExcerpt,
}: {
  event: AgentEvent;
  showExcerpt: boolean;
}) {
  const actor = actorFor(event.name);
  const accent = ACTOR_COLOR[actor];
  const Glyph = EVENT_GLYPH[event.name] ?? MessageSquare;
  const isFailure = event.name === "hermes:task:failed";
  const excerpt = excerptFor(event.name, event.payload);
  const relative = formatRelative(event.at);

  return (
    <li>
      <Card
        isBlurred
        shadow="none"
        radius="md"
        classNames={{
          base: `
            bg-foreground/[0.04] border border-foreground/[0.06]
            transition-[background] duration-150
            hover:bg-foreground/[0.07]
          `,
        }}
      >
        <CardBody className="relative flex flex-row items-start gap-3 px-3 py-2.5">
          {/* Left edge accent — actor brand color. */}
          <span
            className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full"
            style={{ background: accent }}
            aria-hidden
          />
          <span
            className="
              mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center
              rounded-full
            "
            style={{ background: `${accent}33`, color: accent }}
            aria-hidden
          >
            <Glyph className="h-3.5 w-3.5" strokeWidth={2} />
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[12.5px] font-medium text-foreground truncate">
                {EVENT_LABEL[event.name]}
              </span>
              <span className="text-[11px] text-foreground/40 truncate">
                {ACTOR_LABEL[actor]}
              </span>
            </div>
            {showExcerpt && excerpt && (
              <p
                className={
                  "mt-1 text-[12px] truncate " +
                  (isFailure ? "text-danger" : "text-foreground/55")
                }
                title={excerpt}
              >
                {excerpt}
              </p>
            )}
          </div>
          <span className="shrink-0 text-[11px] tabular text-foreground/40">
            {relative}
          </span>
        </CardBody>
      </Card>
    </li>
  );
}

function EmptyTimeline({
  isEmpty,
  hasFilter,
}: {
  isEmpty: boolean;
  hasFilter: boolean;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
      <p className="text-[13px] text-foreground/55">
        {hasFilter
          ? "No events match this filter yet."
          : isEmpty
            ? "Listening for events…"
            : "No events recorded."}
      </p>
      <p className="text-[11px] text-foreground/40">
        Events appear here the moment OpenClaw, Synap, or Hermes does anything.
      </p>
    </div>
  );
}

// ── Relative time formatter ──────────────────────────────────────────────────

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
