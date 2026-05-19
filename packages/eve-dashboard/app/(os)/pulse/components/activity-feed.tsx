"use client";

import { useState } from "react";
import { Chip } from "@heroui/react";
import { ChevronDown, Activity } from "lucide-react";
import type { ActivityFeedData } from "./types";

export interface ActivityFeedProps {
  data: ActivityFeedData | null;
  error?: boolean;
}

const ACTION_COLORS: Record<string, string> = {
  create: "bg-emerald-500",
  created: "bg-emerald-500",
  delete: "bg-red-500",
  deleted: "bg-red-500",
  update: "bg-blue-500",
  updated: "bg-blue-500",
  received: "bg-violet-500",
  approved: "bg-emerald-500",
  rejected: "bg-red-500",
  execute: "bg-amber-500",
  executed: "bg-amber-500",
};

function dotColor(action: string): string {
  return ACTION_COLORS[action] ?? "bg-foreground/30";
}

function elapsed(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function formatEventType(eventType: string): string {
  const parts = eventType.split(".");
  if (parts.length < 2) return eventType;
  const subject = parts[0].replace(/_/g, " ");
  const action = parts[1];
  return `${subject} ${action}`;
}

export function ActivityFeed({ data, error }: ActivityFeedProps) {
  const [open, setOpen] = useState(true);

  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="
          group mb-3 flex w-full items-center gap-2
          rounded-md py-1
          focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40
        "
        aria-expanded={open}
      >
        <Activity className="h-3.5 w-3.5 text-foreground/40" />
        <span className="text-[12px] font-semibold uppercase tracking-wider text-foreground/50">
          Recent Activity
        </span>
        {data && data.events.length > 0 && (
          <Chip size="sm" variant="flat" className="h-4 min-w-0 px-1.5 text-[10px]">
            {data.events.length}
          </Chip>
        )}
        <ChevronDown
          className={`ml-auto h-3.5 w-3.5 text-foreground/30 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="rounded-xl ring-1 ring-inset ring-foreground/[0.07] overflow-hidden">
          {error ? (
            <p className="px-4 py-3 text-[12px] text-foreground/40">
              Activity unavailable — pod not connected.
            </p>
          ) : !data ? (
            <div className="flex flex-col gap-2 px-4 py-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="flex items-center gap-3 animate-pulse">
                  <div className="h-2 w-2 rounded-full bg-foreground/10 shrink-0" />
                  <div className="h-2.5 w-32 rounded bg-foreground/10" />
                  <div className="ml-auto h-2 w-12 rounded bg-foreground/10" />
                </div>
              ))}
            </div>
          ) : data.events.length === 0 ? (
            <p className="px-4 py-3 text-[12px] text-foreground/40">
              No recent activity.
            </p>
          ) : (
            <ul className="divide-y divide-foreground/[0.05]">
              {data.events.map((ev) => {
                const actor = data.actors[ev.userId];
                const actorLabel = actor?.name ?? actor?.email ?? ev.userId.slice(0, 8);
                return (
                  <li key={ev.id} className="flex items-center gap-3 px-4 py-2.5">
                    <span
                      className={`h-2 w-2 rounded-full shrink-0 ${dotColor(ev.action)}`}
                      aria-hidden
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-[12.5px] text-foreground truncate">
                        {formatEventType(ev.eventType)}
                      </p>
                      <p className="text-[10.5px] text-foreground/40 truncate">
                        {actorLabel}
                        {ev.subjectType && (
                          <span className="ml-1.5 font-mono opacity-60">
                            {ev.subjectType}
                          </span>
                        )}
                      </p>
                    </div>
                    <span className="text-[10.5px] text-foreground/35 shrink-0 tabular-nums">
                      {elapsed(ev.timestamp)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
