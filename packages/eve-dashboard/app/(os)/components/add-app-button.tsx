"use client";

/**
 * `AddAppButton` — the dock's `+` terminator.
 *
 * Always rendered last in the dock. Opens the marketplace.
 *
 * Phase 2 wires this to the external CP marketplace URL in a new tab.
 * Phase 4 routes to an in-OS `/marketplace` surface.
 *
 * Visual: same 48×48 bounding box as the dock icons, but with a
 * dashed border and a transparent fill — read as "add", not "app".
 */

import { Plus } from "lucide-react";
import { CP_BASE_URL } from "../lib/cp-oauth";

export function AddAppButton() {
  // The dashboard knows the CP base URL via the OAuth client config —
  // reuse it so the dock + the grid's "+ Add" tile target the same URL.
  const marketplaceUrl = `${CP_BASE_URL}/marketplace`;

  return (
    <a
      href={marketplaceUrl}
      target="_blank"
      rel="noreferrer"
      aria-label="Add app from marketplace"
      title="Marketplace"
      className="
        group flex h-12 w-12 shrink-0 items-center justify-center
        rounded-icon
        border border-dashed border-white/30
        text-white/60
        transition-all duration-200 ease-out
        hover:border-white/60 hover:text-white/95 hover:scale-[1.08]
        active:scale-[0.95]
        focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40
      "
    >
      <Plus className="h-5 w-5" aria-hidden />
    </a>
  );
}
