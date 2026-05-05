"use client";

/**
 * `HomeHeaderContent` — composes the OS Home pane header in a single
 * row: greeting (left), stats + sign-in/settings (right).
 *
 * Replaces the previous two-row arrangement where the greeting + stats
 * sat in the body and only the Settings icon was in the header. By
 * collapsing everything into the header strip we save ~140px of
 * vertical space in the body — the apps grid starts immediately.
 *
 *   [✦ Good afternoon · Tuesday May 5]   [agents 0 · today 0 · updates 0]   [Sign in]  [⚙]
 *
 * The stats pills, sign-in CTA, and settings icon are passed in as the
 * caller pleases (via the same `actions` slot of `PaneHeader`). This
 * component just owns the LEFT half (greeting) and a compact stat pill
 * row that the page composes alongside the auth + settings buttons.
 *
 * See: synap-team-docs/content/team/platform/eve-os-home-design.mdx §3
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { useStats } from "../hooks/use-stats";

// ─── Greeting (header-left) ──────────────────────────────────────────────────

export interface HomeGreetingProps {
  firstName?: string | null;
}

function partOfDay(now: Date): "morning" | "afternoon" | "evening" {
  const h = now.getHours();
  if (h >= 5 && h < 12) return "morning";
  if (h >= 12 && h < 18) return "afternoon";
  return "evening";
}

const DATE_FMT = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
});

export function HomeGreeting({ firstName }: HomeGreetingProps) {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const i = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(i);
  }, []);

  const part = now ? partOfDay(now) : "evening";
  const dateLabel = now ? DATE_FMT.format(now) : "";
  const tail = firstName ? `, ${firstName}` : "";

  return (
    <div className="flex items-center gap-2.5 min-w-0">
      <Sparkles
        className="h-4 w-4 shrink-0 text-primary"
        aria-hidden
        strokeWidth={1.8}
      />
      <div className="min-w-0 flex items-baseline gap-2">
        <h1
          className="
            font-heading font-light leading-none tracking-tight truncate
            text-[15px] text-foreground
          "
        >
          Good {part}{tail}
        </h1>
        <span
          className="hidden sm:inline text-[11.5px] text-foreground/55 tabular-nums shrink-0"
          aria-label={`Today is ${dateLabel}`}
        >
          {dateLabel}
        </span>
      </div>
    </div>
  );
}

// ─── Stat pills (header-right cluster) ───────────────────────────────────────

const ACCENT = {
  agents: "#34D399",
  events: "#A78BFA",
  updates: "#FBBF24",
} as const;

export function HomeStatPills() {
  const { stats, isLoading } = useStats();
  return (
    <div
      className="
        hidden md:flex items-center gap-1
        rounded-full px-1 py-0.5
        bg-foreground/[0.04] border border-foreground/[0.06]
      "
      aria-label="Workspace stats"
    >
      <StatPill
        label="agents"
        value={stats.agentsRunning}
        accent={ACCENT.agents}
        href="/agents"
        isLoading={isLoading}
      />
      <span className="h-3 w-px bg-foreground/[0.10]" aria-hidden />
      <StatPill
        label="today"
        value={stats.eventsToday}
        accent={ACCENT.events}
        href="/agents?view=timeline"
        isLoading={isLoading}
      />
      <span className="h-3 w-px bg-foreground/[0.10]" aria-hidden />
      <StatPill
        label="updates"
        value={stats.updatesAvailable}
        accent={ACCENT.updates}
        href="/marketplace"
        isLoading={isLoading}
      />
    </div>
  );
}

interface StatPillProps {
  label: string;
  value: number;
  accent: string;
  href: string;
  isLoading?: boolean;
}

function StatPill({ label, value, accent, href, isLoading }: StatPillProps) {
  return (
    <Link
      href={href}
      aria-label={`${label}: ${value}`}
      className="
        group flex items-center gap-1.5 rounded-full px-2 py-0.5
        transition-colors duration-150
        hover:bg-foreground/[0.06]
        focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40
      "
    >
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ background: accent }}
        aria-hidden
      />
      {isLoading ? (
        <span
          className="block h-3 w-4 rounded-sm bg-foreground/10 animate-pulse"
          aria-hidden
        />
      ) : (
        <span className="text-[12px] font-medium tabular-nums text-foreground">
          {value}
        </span>
      )}
      <span className="text-[11px] uppercase tracking-[0.04em] text-foreground/55 group-hover:text-foreground/80 transition-colors">
        {label}
      </span>
    </Link>
  );
}
