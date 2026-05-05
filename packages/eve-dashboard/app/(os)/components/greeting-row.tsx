"use client";

/**
 * `GreetingRow` — greeting block + 3 visionOS-style stat squares on a
 * single horizontal row.
 *
 * Layout (desktop):
 *
 *   [ ✦ Good evening                  ] [ ☐ ] [ ☐ ] [ ☐ ]
 *   [   Tuesday · May 5               ]
 *
 * Layout (mobile):
 *   greeting on top, three squares below in a 3-up grid.
 *
 * The stat squares are HeroUI `Card`s with `isBlurred shadow="none"`
 * so they layer correctly over the frosted pane (visionOS material —
 * surfaces don't cast shadows; depth comes from translucent stacking).
 *
 * Text uses HeroUI vibrancy tiers via `text-foreground` + opacity:
 *   • greeting heading: gradient text-fill on top of foreground
 *   • value:           text-foreground (100%)
 *   • label:           text-foreground/55 (secondary)
 *   • date subtitle:   text-foreground/55
 *
 * See: synap-team-docs/content/team/platform/eve-os-home-design.mdx §3–§4
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { Card, CardBody } from "@heroui/react";
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
      {/* Greeting block */}
      <div className="flex items-center gap-3 sm:gap-4 min-w-0">
        <Sparkles
          className="h-6 w-6 shrink-0 text-primary"
          aria-hidden
          strokeWidth={1.6}
        />
        <div className="min-w-0">
          <h1
            className="
              font-heading font-light leading-[1.05] tracking-tight truncate
              text-[26px] sm:text-[28px] md:text-[32px]
              bg-gradient-to-br from-emerald-200 via-foreground to-violet-200
              bg-clip-text text-transparent
            "
          >
            Good {part}{tail}
          </h1>
          <p className="mt-1.5 text-[12px] text-foreground/55 tabular">
            {dateLabel}
          </p>
        </div>
      </div>

      {/* Three compact square stat tiles */}
      <div className="grid grid-cols-3 gap-2 shrink-0">
        <StatSquare
          label="Agents"
          value={stats.agentsRunning}
          accent={ACCENT.agents}
          href="/agents"
          isLoading={isLoading}
        />
        <StatSquare
          label="Today"
          value={stats.eventsToday}
          accent={ACCENT.events}
          href="/agents?view=timeline"
          isLoading={isLoading}
        />
        <StatSquare
          label="Updates"
          value={stats.updatesAvailable}
          accent={ACCENT.updates}
          href={`${CP_BASE_URL}/marketplace`}
          external
          isLoading={isLoading}
        />
      </div>
    </div>
  );
}

// ── Single visionOS-style stat tile ──────────────────────────────────────────

interface StatSquareProps {
  label: string;
  value: number;
  accent: string;
  href: string;
  external?: boolean;
  isLoading?: boolean;
}

function StatSquare({
  label, value, accent, href, external, isLoading,
}: StatSquareProps) {
  const card = (
    <Card
      isBlurred
      shadow="none"
      radius="lg"
      classNames={{
        base: `
          h-[78px] w-[78px] sm:h-[88px] sm:w-[88px]
          bg-foreground/[0.05] border border-foreground/[0.08]
          transition-[background,border-color] duration-200 ease-out
          hover:bg-foreground/[0.08] hover:border-foreground/[0.14]
        `,
      }}
    >
      <CardBody className="relative flex flex-col items-start justify-between p-2.5 sm:p-3">
        <div className="flex items-center gap-1.5">
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ background: accent }}
            aria-hidden
          />
          <span className="text-[10px] font-medium uppercase tracking-[0.06em] text-foreground/55">
            {label}
          </span>
        </div>
        {isLoading ? (
          <span
            className="block h-7 w-8 rounded-md bg-foreground/10 animate-shimmer-pulse"
            aria-hidden
          />
        ) : (
          <span className="font-heading text-[26px] font-light leading-none tabular text-foreground sm:text-[30px]">
            {value}
          </span>
        )}
      </CardBody>
    </Card>
  );

  const ariaLabel = `${label}: ${value}`;

  if (external) {
    return (
      <a href={href} target="_blank" rel="noreferrer" aria-label={ariaLabel} className="block">
        {card}
      </a>
    );
  }
  return (
    <Link href={href} aria-label={ariaLabel} className="block">
      {card}
    </Link>
  );
}
