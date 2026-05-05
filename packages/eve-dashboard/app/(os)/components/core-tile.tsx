"use client";

/**
 * `CoreTile` — pinned tile for first-party Eve apps (Inbox, Pulse,
 * Agents, Marketplace, Settings).
 *
 * Mirrors `AppIcon`'s visual recipe (visionOS glass-icon, concentric
 * radii, single-line truncated label) but routes via Next.js `Link`
 * because targets live inside the Eve OS shell — opening them in a
 * new tab would break the pane experience. Optional `count` chip
 * surfaces an unread/pending counter (e.g. open proposals on Inbox).
 *
 * Keep this in lockstep with `app-icon.tsx` — if you change the glyph
 * size, ring, or label tier there, mirror it here.
 */

import Link from "next/link";
import { brandColorFor } from "../lib/brand-colors";
import {
  Box, Sparkles, Inbox, Activity, Store, Settings as SettingsIcon,
  type LucideIcon,
} from "lucide-react";

const GLYPHS: Record<string, LucideIcon> = {
  Sparkles, Inbox, Activity, Store, Settings: SettingsIcon,
};

export interface CoreTileSpec {
  id: string;
  href: string;
  name: string;
  /** Optional numeric badge (top-right of the glyph). 0 = hidden. */
  count?: number;
}

export function CoreTile({ spec }: { spec: CoreTileSpec }) {
  const palette = brandColorFor(spec.id);
  const Glyph = palette.glyph ? GLYPHS[palette.glyph] ?? Box : Box;
  const showCount = typeof spec.count === "number" && spec.count > 0;

  return (
    <Link
      href={spec.href}
      aria-label={`Open ${spec.name}`}
      className="
        group flex w-full max-w-[104px] flex-col items-center gap-2
        focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40
        focus-visible:rounded-app-icon
      "
    >
      <span
        className="
          relative
          glass-icon
          flex h-[68px] w-[68px] items-center justify-center
          transition-transform duration-200 ease-out
          group-hover:scale-[1.04]
          group-active:scale-[0.96] group-active:duration-[80ms]
          sm:h-[72px] sm:w-[72px]
        "
        style={{ background: palette.bg }}
      >
        <Glyph
          className="h-7 w-7 text-white sm:h-[30px] sm:w-[30px]"
          strokeWidth={2}
          aria-hidden
        />
        {showCount && (
          <span
            className="
              absolute -right-1.5 -top-1.5 z-10
              inline-flex h-5 min-w-5 items-center justify-center
              rounded-full px-1.5
              bg-danger ring-2 ring-background
              text-[10px] font-semibold leading-none text-danger-foreground
            "
            aria-label={`${spec.count} pending`}
          >
            {spec.count! > 99 ? "99+" : spec.count}
          </span>
        )}
      </span>

      <span className="flex w-full flex-col items-center leading-none">
        <span
          className="
            block w-full truncate text-center text-[12px] font-medium
            text-foreground
          "
          title={spec.name}
        >
          {spec.name}
        </span>
      </span>
    </Link>
  );
}
