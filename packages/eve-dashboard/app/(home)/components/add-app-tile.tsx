"use client";

/**
 * `AddAppTile` — last tile in the grid. Routes to the CP marketplace.
 *
 * Phase 2A opens `https://cp.synap.sh/marketplace` (or whatever the
 * `NEXT_PUBLIC_CP_BASE_URL` points at) in a new tab. Phase 2B+ will
 * embed the catalog in a slide-over inside Eve.
 */

import { Plus } from "lucide-react";
import { CP_BASE_URL } from "../lib/cp-oauth";

export function AddAppTile() {
  const href = `${CP_BASE_URL}/marketplace`;

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label="Browse marketplace to add an app"
      className="
        group relative aspect-square w-full
        flex flex-col items-center justify-center gap-1.5
        rounded-tile border-[1.5px] border-dashed border-default-300
        bg-transparent text-default-500
        transition-colors duration-200
        hover:border-default-400 hover:text-foreground hover:bg-content2/50
        focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background
      "
    >
      <Plus className="h-7 w-7" aria-hidden />
      <span className="text-[12px] font-medium">Add</span>
    </a>
  );
}
