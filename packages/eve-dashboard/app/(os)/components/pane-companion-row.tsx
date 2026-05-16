"use client";

/**
 * `PaneCompanionRow` — flex-row peer container for the active `Pane` and
 * the optional `Companion` surface.
 *
 * Why this exists: the OS shell used to be a stack of fixed-position
 * siblings (Wallpaper / Pane / Dock / OverlayHost). The companion needs
 * to LIVE NEXT TO the pane so opening it shifts the pane left rather
 * than covering it. We wrap just Pane + Companion in a flex row so the
 * other shell layers keep their existing positioning.
 *
 * Layout math:
 *   • Closed: companion width = 0, row center-justifies → pane stays
 *     visually centered (matches the legacy single-pane layout).
 *   • Open:   companion width = clamp(380px, 38vw, 540px) with a 280ms
 *     cubic-bezier transition. Flex re-balances the row in the same
 *     frame, so the pane slides left smoothly without an explicit width
 *     transition of its own.
 *
 * The Wallpaper / Dock / OverlayHost layers stay fixed-position siblings
 * to this row in `layout.tsx`.
 */

import type { ReactNode } from "react";
import { Pane } from "./pane";
import { Companion } from "./companion";
import { useCompanionStore } from "../stores/companion-store";

const COMPANION_WIDTH_OPEN = "clamp(380px, 38vw, 540px)";
const COMPANION_WIDTH_CLOSED = "0px";

export function PaneCompanionRow({ children }: { children: ReactNode }) {
  const open = useCompanionStore((s) => s.open);
  const width = open ? COMPANION_WIDTH_OPEN : COMPANION_WIDTH_CLOSED;

  return (
    <div
      className="
        relative z-10 flex min-h-screen items-start justify-center
        gap-4 px-4 pt-4 pb-28
        sm:pt-8 md:items-center md:pt-0 md:pb-24
      "
    >
      <Pane>{children}</Pane>
      <Companion width={width} />
    </div>
  );
}
