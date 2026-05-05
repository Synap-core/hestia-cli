"use client";

/**
 * `StatCard` — single 110px-tall translucent card in the stat strip.
 *
 * Click navigates to the relevant deep-link. On hover the card gains
 * a soft inner glow ring keyed to its accent color (no translateY).
 *
 * See: synap-team-docs/content/team/platform/eve-os-home-design.mdx §4
 */

import Link from "next/link";

export interface StatCardProps {
  label: string;
  value: string;
  sublabel?: string;
  /** Hex string used for the hover glow ring. */
  accent: string;
  href: string;
  /** Open in a new tab when the target is external (e.g. CP marketplace). */
  external?: boolean;
  /** Show the shimmer pulse instead of the value. */
  isLoading?: boolean;
  /** Aria-label for screen readers. Falls back to "{label} {value}". */
  ariaLabel?: string;
}

export function StatCard({
  label,
  value,
  sublabel,
  accent,
  href,
  external,
  isLoading,
  ariaLabel,
}: StatCardProps) {
  const surface = (
    <span
      className="
        group flex h-[110px] flex-col justify-between rounded-2xl
        border border-white/[0.08] bg-white/[0.06]
        p-4 backdrop-blur-md
        transition-[background,box-shadow] duration-200 ease-out
        hover:bg-white/[0.10]
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40
      "
      style={
        {
          // Custom property consumed by the hover :hover ring below
          // via tailwind arbitrary value — keeps the accent per-card.
          ["--card-accent" as string]: `${accent}59`, // 35% alpha
        } as React.CSSProperties
      }
    >
      <span className="text-[11px] font-medium uppercase tracking-[0.05em] text-default-400">
        {label}
      </span>
      {isLoading ? (
        <span
          className="block h-6 w-24 rounded-md bg-white/10 animate-shimmer-pulse"
          aria-hidden
        />
      ) : (
        <span className="font-heading text-2xl font-light text-foreground tabular leading-none">
          {value}
        </span>
      )}
      {sublabel && !isLoading ? (
        <span className="text-[12px] text-default-500 truncate">{sublabel}</span>
      ) : (
        <span className="h-[14px]" aria-hidden />
      )}

      <span
        className="
          pointer-events-none absolute inset-0 rounded-2xl opacity-0
          transition-opacity duration-200 ease-out
          group-hover:opacity-100
        "
        style={{
          boxShadow: `inset 0 0 0 1px var(--card-accent), 0 0 24px -8px var(--card-accent)`,
        }}
        aria-hidden
      />
    </span>
  );

  const className = "relative block";

  if (external) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        aria-label={ariaLabel ?? `${label} ${value}`}
        className={className}
      >
        {surface}
      </a>
    );
  }
  return (
    <Link href={href} aria-label={ariaLabel ?? `${label} ${value}`} className={className}>
      {surface}
    </Link>
  );
}
