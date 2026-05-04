"use client";

/**
 * `Greeting` — soft welcome line above the app grid.
 *
 * "Good morning/afternoon/evening, {firstName}" + a light-weight
 * date+time. Hides on viewports narrower than 768px so phones get
 * straight to the grid (eve-os-home-design.mdx §3.2).
 *
 * `firstName` is optional: when no user object is wired through (the
 * common case in Phase 2A — auth is just a session JWT), we drop the
 * comma and render a clean "Good evening".
 */

import { useEffect, useState } from "react";

export interface GreetingProps {
  firstName?: string | null;
}

function partOfDay(now: Date): "morning" | "afternoon" | "evening" {
  const h = now.getHours();
  if (h < 12) return "morning";
  if (h < 18) return "afternoon";
  return "evening";
}

const DAY_FMT = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
});

const TIME_FMT = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
  hour12: false,
});

export function Greeting({ firstName }: GreetingProps) {
  // Re-render every minute so the time stays accurate. The clock is
  // small enough that this won't blow up reconciliation.
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const i = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(i);
  }, []);

  if (!now) {
    // SSR — render a neutral placeholder to avoid hydration mismatch
    // on `Date.now()`.
    return (
      <div className="hidden md:block py-8 lg:py-10">
        <p className="font-heading text-2xl font-light text-foreground">
          Good evening{firstName ? `, ${firstName}` : ""}
        </p>
        <p className="mt-0.5 text-sm text-default-500">&nbsp;</p>
      </div>
    );
  }

  return (
    <div className="hidden md:block py-8 lg:py-10">
      <p className="font-heading text-2xl font-light tracking-tightest text-foreground">
        Good {partOfDay(now)}{firstName ? `, ${firstName}` : ""}
      </p>
      <p className="mt-0.5 text-sm text-default-500 tabular">
        {DAY_FMT.format(now)} · {TIME_FMT.format(now)}
      </p>
    </div>
  );
}
