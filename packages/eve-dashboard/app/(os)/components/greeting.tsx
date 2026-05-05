"use client";

/**
 * `Greeting` — Zone A of the Home pane.
 *
 * "✦ Good {morning|afternoon|evening}, {firstName}" with a subtle
 * gradient text fill, a small Sparkles glyph to the left, and a
 * date subtitle below.
 *
 * Centered horizontally, generous vertical padding. The brand glyph
 * stacks above the greeting on mobile (<640px).
 *
 * See: synap-team-docs/content/team/platform/eve-os-home-design.mdx §3
 */

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";

export interface GreetingProps {
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

export function Greeting({ firstName }: GreetingProps) {
  // Re-render every minute so the greeting flips at the boundary
  // (05:00 / 12:00 / 18:00). Cheap — single text node.
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const i = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(i);
  }, []);

  const part = now ? partOfDay(now) : "evening";
  const dateLabel = now
    ? DATE_FMT.format(now).replace(/,/, " ·")
    : " ";

  // Trim "Welcome back" greeting when no profile resolved.
  const tail = firstName ? `, ${firstName}` : "";

  return (
    <div className="flex flex-col items-center gap-3 px-6 pt-12 pb-8 text-center sm:flex-row sm:gap-4 sm:justify-center sm:py-12">
      <Sparkles
        className="h-6 w-6 shrink-0 text-emerald-400"
        aria-hidden
        strokeWidth={1.5}
      />
      <div>
        <p
          className="
            font-heading font-light leading-none tracking-tight
            text-2xl sm:text-[28px] md:text-[32px]
            bg-gradient-to-br from-emerald-300 via-emerald-200 to-violet-300
            bg-clip-text text-transparent
          "
        >
          Good {part}{tail}
        </p>
        <p className="mt-2 text-xs text-default-500 tabular sm:text-[13px]">
          {dateLabel}
        </p>
      </div>
    </div>
  );
}
