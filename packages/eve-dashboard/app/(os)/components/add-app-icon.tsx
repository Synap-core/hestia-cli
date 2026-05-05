"use client";

/**
 * `AddAppIcon` — dashed `+` terminator at the end of the Home grid.
 *
 * Same 80×80 bounding box as a real `AppIcon`, but with a dashed
 * border and transparent fill. Click opens the marketplace.
 *
 * Phase 2: external CP marketplace URL in a new tab.
 * Phase 4: in-OS `/marketplace` route.
 *
 * See: synap-team-docs/content/team/platform/eve-os-home-design.mdx §5.6
 */

import { Plus } from "lucide-react";
import { CP_BASE_URL } from "../lib/cp-oauth";

export function AddAppIcon() {
  const marketplaceUrl = `${CP_BASE_URL}/marketplace`;

  return (
    <a
      href={marketplaceUrl}
      target="_blank"
      rel="noreferrer"
      aria-label="Browse marketplace"
      className="
        group flex flex-col items-center gap-3
        focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40
        focus-visible:rounded-2xl
      "
    >
      <span
        className="
          flex h-16 w-16 items-center justify-center
          rounded-[18px] border border-dashed border-default-400
          text-default-400
          transition-all duration-200 ease-out
          group-hover:scale-[1.04] group-active:scale-[0.96]
          group-hover:border-default-200 group-hover:text-default-100
          sm:h-20 sm:w-20
        "
      >
        <Plus className="h-7 w-7" aria-hidden />
      </span>
      <span className="text-[13px] font-medium text-default-500 group-hover:text-default-300 transition-colors">
        Add
      </span>
    </a>
  );
}
