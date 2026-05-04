"use client";

/**
 * `EmptyState` — shown when the user has zero apps installed and no
 * auto-discovered local components. Rare in practice (OpenWebUI
 * usually auto-pins) but possible on a fresh, half-installed pod.
 *
 * Placeholder LayoutGrid icon for now — design §3.7 calls for a
 * commissioned mono line illustration; that's deferred to Phase 2B.
 */

import { LayoutGrid, ArrowRight } from "lucide-react";
import { CP_BASE_URL } from "../lib/cp-oauth";

export function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 lg:py-24 text-center">
      <div
        className="
          flex h-20 w-20 items-center justify-center
          rounded-tile border border-divider bg-content1/60
          text-default-300
        "
        aria-hidden
      >
        <LayoutGrid className="h-10 w-10" strokeWidth={1.25} />
      </div>

      <h2 className="mt-6 font-heading text-2xl font-light tracking-tightest text-foreground">
        Your OS is a blank canvas
      </h2>
      <p className="mt-2 max-w-md text-base text-default-500">
        Install your first app from the marketplace to get started.
      </p>

      <a
        href={`${CP_BASE_URL}/marketplace`}
        target="_blank"
        rel="noreferrer"
        className="
          mt-6 inline-flex items-center gap-1.5 rounded-lg
          bg-primary px-4 py-2 text-sm font-medium text-primary-foreground
          transition-colors hover:bg-primary/90
        "
      >
        Browse marketplace
        <ArrowRight className="h-3.5 w-3.5" />
      </a>
    </div>
  );
}
