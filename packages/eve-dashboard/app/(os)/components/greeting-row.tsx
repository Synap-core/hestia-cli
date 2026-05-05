"use client";

/**
 * `GreetingRow` — Zone A + Zone B fused into a single horizontal row.
 *
 * Layout:
 *
 *   [ ✦ Good evening                  ] [ ☐ ] [ ☐ ] [ ☐ ]
 *   [   Tuesday · May 5               ]
 *   ↑ flex-1, left-aligned              ↑ three compact stat squares
 *
 * On mobile (< 640px) the squares stack below the greeting in a 3-up
 * grid; the greeting stays left-aligned.
 *
 * Concentric radius rule:
 *   pane radius (32) − body padding (20) = card radius (12)
 *
 * Each square is 92×92 (mobile) / 104×104 (md) / 112×112 (lg). Square
 * shape is mandatory per the v2.1 design pass — they read as glanceable
 * facts, not data widgets.
 *
 * See: synap-team-docs/content/team/platform/eve-os-home-design.mdx §3–§4
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { useStats } from "../hooks/use-stats";
import { CP_BASE_URL } from "../lib/cp-oauth";

export interface GreetingRowProps {
  firstName?: string | null;
}

function partOfDay(now: Date): "morning" | "afternoon" | "evening" {
  const h = now.getHours();
  if (h >= 5 && h < 12) return "morning";
  if (h >= 12 && h < 18) return "afternoon";
  return "evening";
}

const DATE_FMT = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "long",
  day: "numeric",
});

const ACCENT = {
  agents:  "#34D399",
  events:  "#A78BFA",
  updates: "#FBBF24",
} as const;

export function GreetingRow({ firstName }: GreetingRowProps) {
  const [now, setNow] = useState<Date | null>(null);
  const { stats, isLoading } = useStats();

  useEffect(() => {
    setNow(new Date());
    const i = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(i);
  }, []);

  const part = now ? partOfDay(now) : "evening";
  const dateLabel = now ? DATE_FMT.format(now).replace(/,/, " ·") : "";
  const tail = firstName ? `, ${firstName}` : "";

  return (
    <div
      className="
        flex flex-col gap-5
        sm:flex-row sm:items-end sm:justify-between sm:gap-6
      "
    >
      {/* Left: greeting block */}
      <div className="flex items-center gap-3 sm:gap-4 min-w-0">
        <Sparkles
          className="h-7 w-7 shrink-0 text-emerald-300/90"
          aria-hidden
          strokeWidth={1.6}
        />
        <div className="min-w-0">
          <p
            className="
              font-heading font-light leading-[1.05] tracking-tight truncate
              text-[26px] sm:text-[28px] md:text-[32px]
              bg-gradient-to-br from-emerald-200 via-emerald-100 to-violet-200
              bg-clip-text text-transparent
            "
          >
            Good {part}{tail}
          </p>
          <p className="mt-1.5 text-[12px] text-default-400 dark:text-default-500 tabular">
            {dateLabel}
          </p>
        </div>
      </div>

      {/* Right: three compact square stat tiles */}
      <div className="grid grid-cols-3 gap-2 sm:gap-2.5 shrink-0">
        <StatSquare
          label="Agents"
          value={stats.agentsRunning}
          sublabel={isLoading ? "—" : (stats.agentsSubLabel ?? "")}
          accent={ACCENT.agents}
          href="/agents"
          isLoading={isLoading}
        />
        <StatSquare
          label="Today"
          value={stats.eventsToday}
          sublabel={isLoading ? "—" : "events"}
          accent={ACCENT.events}
          href="/agents?view=timeline"
          isLoading={isLoading}
        />
        <StatSquare
          label="Updates"
          value={stats.updatesAvailable}
          sublabel={
            isLoading
              ? "—"
              : stats.updatesAvailable === 0
                ? "up to date"
                : "available"
          }
          accent={ACCENT.updates}
          href={`${CP_BASE_URL}/marketplace`}
          external
          isLoading={isLoading}
        />
      </div>
    </div>
  );
}

// ── Single 92×92 square stat tile ────────────────────────────────────────────

interface StatSquareProps {
  label: string;
  value: number;
  sublabel: string;
  accent: string;
  href: string;
  external?: boolean;
  isLoading?: boolean;
}

function StatSquare({
  label, value, sublabel, accent, href, external, isLoading,
}: StatSquareProps) {
  const body = (
    <span
      className="
        group relative flex h-[92px] w-[92px] flex-col items-start justify-between
        rounded-stat-card
        border border-white/[0.08] bg-white/[0.04]
        p-3 backdrop-blur-md
        transition-[background,border-color,box-shadow] duration-200 ease-out
        hover:bg-white/[0.08] hover:border-white/[0.14]
        sm:h-[104px] sm:w-[104px] sm:p-3.5
        md:h-[112px] md:w-[112px]
      "
      style={{ ["--card-accent" as string]: accent } as React.CSSProperties}
    >
      <span className="text-[10px] font-medium uppercase tracking-[0.06em] text-default-500">
        {label}
      </span>
      {isLoading ? (
        <span
          className="block h-6 w-10 rounded-md bg-white/10 animate-shimmer-pulse"
          aria-hidden
        />
      ) : (
        <span
          className="
            font-heading text-[26px] font-light leading-none tabular text-foreground
            sm:text-[30px] md:text-[34px]
          "
        >
          {value}
        </span>
      )}
      <span
        className="
          block w-full truncate text-[10.5px] leading-tight text-default-500
        "
        title={sublabel}
      >
        {sublabel || " "}
      </span>

      {/* Hover-only accent ring (inset). Color comes from --card-accent. */}
      <span
        className="
          pointer-events-none absolute inset-0 rounded-stat-card
          opacity-0 transition-opacity duration-200
          group-hover:opacity-100
        "
        style={{
          boxShadow:
            "inset 0 0 0 1px var(--card-accent), 0 0 18px -8px var(--card-accent)",
        }}
        aria-hidden
      />
    </span>
  );

  if (external) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        aria-label={`${label}: ${value} ${sublabel}`}
        className="block"
      >
        {body}
      </a>
    );
  }
  return (
    <Link
      href={href}
      aria-label={`${label}: ${value} ${sublabel}`}
      className="block"
    >
      {body}
    </Link>
  );
}
