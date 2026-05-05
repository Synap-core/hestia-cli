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
    <div
      className="flex flex-col items-center gap-3"
      aria-hidden
    >
      <span
        className="
          h-16 w-16 rounded-[18px] bg-white/10 animate-shimmer-pulse
          sm:h-20 sm:w-20
        "
      />
      <span className="block h-3 w-12 rounded-full bg-white/10 animate-shimmer-pulse" />
    </div>
  );
}
