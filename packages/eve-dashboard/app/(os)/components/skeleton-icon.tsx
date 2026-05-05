"use client";

/**
 * `SkeletonIcon` — placeholder for an unresolved app while marketplace
 * + local components are still loading. Same dimensions as the live
 * icon so the grid never reflows on resolve.
 *
 * See: synap-team-docs/content/team/platform/eve-os-home-design.mdx §9
 */

export function SkeletonIcon() {
  return (
    <div className="flex flex-col items-center gap-2" aria-hidden>
      <span
        className="
          h-[68px] w-[68px] rounded-app-icon bg-foreground/[0.06]
          animate-shimmer-pulse
          sm:h-[72px] sm:w-[72px]
        "
      />
      <span className="block h-3 w-12 rounded-full bg-foreground/[0.06] animate-shimmer-pulse" />
    </div>
  );
}
