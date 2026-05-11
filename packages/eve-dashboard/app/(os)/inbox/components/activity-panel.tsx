"use client";

/**
 * Inbox — Activity panel.
 *
 * USER channel — talks to the pod via tRPC over `/api/pod/*`. The
 * `events.read` query is user-scoped on the pod side (the operator's
 * own activity stream), so the user-channel credential is exactly what
 * we need. See eve-credentials.mdx for the two-channel rule.
 *
 * Reads the recent event log via
 *   GET /api/pod/trpc/events.read?input={"json":{"limit":50}}
 * and renders a vertical timeline grouped by day. Each row shows:
 *
 *   • Tone dot (left rail) — derives a colour from the event family
 *     (entity / proposal / agent / system).
 *   • Event-type Chip — the raw `type` string, monospace-ish.
 *   • One-line description — synthesised from `subjectType + data`.
 *   • Relative time (right-aligned).
 *
 * No pagination — 50 is enough for the daily-driver view. When events
 * exceed a few hundred we'll likely surface a dedicated audit page
 * instead of inlining a paged list here.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, Chip } from "@heroui/react";
import { Activity } from "lucide-react";
import { PanelEmpty, PanelError, PanelLoader } from "./panel-states";

/**
 * Pod wire shape for `events.read` (lean: false). The canonical wire
 * field for the event-type string is `type` — see the events router for
 * the projection. We treat `timestamp` as `string | Date` because the
 * raw fetch path receives the superjson-encoded ISO string while typed
 * tRPC clients would receive a Date.
 */
interface WireEvent {
  id: string;
  type: string;
  subjectType?: string | null;
  subjectId?: string | null;
  userId?: string | null;
  data?: Record<string, unknown> | null;
  timestamp?: string | Date | null;
}

/** ISO string from either a string or Date timestamp. `null` on absent. */
function getTimestamp(evt: WireEvent): string | null {
  const ts = evt.timestamp;
  if (!ts) return null;
  if (typeof ts === "string") return ts;
  if (ts instanceof Date) return ts.toISOString();
  return null;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; events: WireEvent[] }
  | { kind: "error"; message: string };

interface TrpcEnvelope<T> {
  result?: { data?: { json?: T } | T };
  error?: { message?: string };
}

function unwrapTrpc<T>(env: TrpcEnvelope<T> | null): T | null {
  if (!env) return null;
  const data = env.result?.data;
  if (data && typeof data === "object" && "json" in data) {
    return (data as { json?: T }).json ?? null;
  }
  return (data as T) ?? null;
}

export function ActivityPanel() {
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });

  const fetchEvents = useCallback(async () => {
    setLoad({ kind: "loading" });
    try {
      const input = encodeURIComponent(
        JSON.stringify({ json: { limit: 50 } }),
      );
      const r = await fetch(`/api/pod/trpc/events.read?input=${input}`, {
        credentials: "include",
        cache: "no-store",
      });
      if (!r.ok) {
        const txt = await r.text().catch(() => "");
        throw new Error(
          txt && txt.length < 200 ? txt : `Pod returned ${r.status}`,
        );
      }
      const json = (await r.json().catch(() => null)) as TrpcEnvelope<
        WireEvent[]
      > | null;
      // `events.read` returns a bare array of events.
      const data = unwrapTrpc<WireEvent[]>(json);
      const events: WireEvent[] = Array.isArray(data) ? data : [];
      setLoad({ kind: "ready", events });
    } catch (err) {
      setLoad({
        kind: "error",
        message: err instanceof Error ? err.message : "Network error",
      });
    }
  }, []);

  useEffect(() => {
    void fetchEvents();
  }, [fetchEvents]);

  const grouped = useMemo(() => {
    if (load.kind !== "ready") return [];
    return groupByDay(load.events);
  }, [load]);

  if (load.kind === "loading") return <PanelLoader />;
  if (load.kind === "error") {
    return <PanelError message={load.message} onRetry={fetchEvents} />;
  }
  if (load.events.length === 0) {
    return (
      <PanelEmpty
        icon={Activity}
        title="No recent activity"
        hint="Events from agents, automations, and connectors will land here as they happen."
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {grouped.map((group) => (
        <section key={group.day}>
          <header className="mb-2 flex items-baseline gap-2">
            <h2 className="text-[13px] font-medium text-foreground">
              {group.label}
            </h2>
            <span className="text-[11px] tabular-nums text-foreground/45">
              {group.events.length}
            </span>
          </header>
          <Card
            radius="md"
            shadow="none"
            className="
              flex flex-col
              bg-foreground/[0.04]
              ring-1 ring-inset ring-foreground/10
              overflow-hidden
            "
          >
            {group.events.map((evt, idx) => (
              <EventRow
                key={evt.id}
                evt={evt}
                isLast={idx === group.events.length - 1}
              />
            ))}
          </Card>
        </section>
      ))}
    </div>
  );
}

// ─── Row ─────────────────────────────────────────────────────────────────────

function EventRow({ evt, isLast }: { evt: WireEvent; isLast: boolean }) {
  const tone = toneFor(evt.type);
  const description = describe(evt);
  const time = relativeTime(getTimestamp(evt));

  return (
    <div
      className={
        "flex items-start gap-3 px-4 py-3 " +
        (isLast ? "" : "border-b border-foreground/[0.06]")
      }
    >
      <span
        className={"mt-1.5 h-2 w-2 shrink-0 rounded-full " + tone}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Chip
            size="sm"
            variant="flat"
            radius="sm"
            className="
              h-5 px-1.5 text-[10.5px] font-mono lowercase
              text-foreground/65
            "
          >
            {evt.type || "unknown"}
          </Chip>
          {evt.subjectType && (
            <span className="text-[11px] text-foreground/45">
              {evt.subjectType}
            </span>
          )}
        </div>
        {description && (
          <p className="mt-1 line-clamp-2 text-[12.5px] leading-snug text-foreground/75">
            {description}
          </p>
        )}
      </div>
      {time && (
        <span className="shrink-0 text-[11px] tabular-nums text-foreground/45">
          {time}
        </span>
      )}
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface DayGroup {
  day: string; // YYYY-MM-DD
  label: string;
  events: WireEvent[];
}

function groupByDay(events: WireEvent[]): DayGroup[] {
  const map = new Map<string, WireEvent[]>();
  for (const evt of events) {
    const tsStr = getTimestamp(evt);
    const ts = tsStr ? new Date(tsStr) : null;
    const day = ts && !Number.isNaN(ts.getTime())
      ? ts.toISOString().slice(0, 10)
      : "unknown";
    const arr = map.get(day);
    if (arr) arr.push(evt);
    else map.set(day, [evt]);
  }
  // Sort days desc (newest first).
  const days = Array.from(map.keys()).sort((a, b) => (a < b ? 1 : -1));
  return days.map((day) => ({
    day,
    label: dayLabel(day),
    events: map.get(day)!,
  }));
}

function dayLabel(day: string): string {
  if (day === "unknown") return "Unknown date";
  const today = new Date();
  const todayKey = today.toISOString().slice(0, 10);
  if (day === todayKey) return "Today";
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const yKey = yesterday.toISOString().slice(0, 10);
  if (day === yKey) return "Yesterday";
  return new Date(`${day}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/**
 * Map an event type to a tone-colour dot. We bucket by family rather
 * than per-event so the rail reads as a single visual rhythm. Tolerant
 * of empty / non-string types — falls through to the neutral default.
 */
function toneFor(type: string): string {
  if (!type) return "bg-foreground/35";
  if (type.startsWith("proposal.") || type.includes(".validated")) {
    return "bg-success/85";
  }
  if (type.includes("rejected") || type.includes("failed") || type.includes("error")) {
    return "bg-danger/85";
  }
  if (type.startsWith("agent.") || type.startsWith("ai.") || type.includes(".triggered")) {
    return "bg-primary/80";
  }
  if (type.startsWith("entity.") || type.startsWith("relation.")) {
    return "bg-foreground/55";
  }
  return "bg-foreground/35";
}

/**
 * Best-effort one-line description. Pulls `data.summary` when set;
 * otherwise composes a generic phrase from subject metadata.
 */
function describe(evt: WireEvent): string | null {
  const data = evt.data ?? {};
  if (typeof data.summary === "string" && data.summary) return data.summary;
  if (typeof data.title === "string" && data.title) return data.title;
  if (typeof data.name === "string" && data.name) return data.name;
  if (typeof data.message === "string" && data.message) return data.message;

  // Fallback: "<type> on <subject>".
  const subj = evt.subjectType
    ? `${evt.subjectType}${evt.subjectId ? " " + evt.subjectId.slice(0, 8) : ""}`
    : null;
  if (subj) return `${prettyVerb(evt.type)} on ${subj}`;
  return null;
}

function prettyVerb(type: string): string {
  // entity.created → "entity created"
  if (!type) return "event";
  return type.replace(/_/g, " ").replace(/\./g, " ");
}

function relativeTime(ts: string | null): string | null {
  if (!ts) return null;
  const t = new Date(ts).getTime();
  if (Number.isNaN(t)) return null;
  const diff = Date.now() - t;
  if (diff < 60_000) return "just now";
  const min = Math.floor(diff / 60_000);
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}
