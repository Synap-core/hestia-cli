"use client";

/**
 * `AddAppButton` — the dock's `+` terminator.
 *
 * Same 40×40 bounding box as a real DockIcon. No glass recipe (we want
 * this to feel like empty real estate, not a launcher tile) — just a
 * frosted pill with a soft inner stroke and a centered `+` glyph.
 *
 * Routes to the in-OS marketplace. The landing-page catalog is still
 * accessible via the public synap.live/marketplace URL for SEO /
 * sharing, but this button keeps the user inside Eve.
 */

import Link from "next/link";
import { Plus } from "lucide-react";

export function AddAppButton() {
  return (
    <Link
      href="/marketplace"
      aria-label="Open marketplace"
      title="Marketplace"
      className="
        group inline-flex h-10 w-10 shrink-0 items-center justify-center
        rounded-app-icon
        bg-foreground/[0.06]
        ring-1 ring-inset ring-foreground/15
        text-foreground/55
        transition-all duration-200 ease-out
        hover:bg-foreground/[0.10] hover:text-foreground hover:scale-[1.10]
        active:scale-[0.95]
        focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50
      "
    >
      <Plus className="h-5 w-5" strokeWidth={2.2} aria-hidden />
    </Link>
  );
}
