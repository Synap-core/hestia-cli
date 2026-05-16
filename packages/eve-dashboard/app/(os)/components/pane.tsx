"use client";

/**
 * `Pane` — Layer 2 of the Eve OS shell.
 *
 * The frosted-glass popup that holds the active app. Sits centered over
 * the wallpaper, clear of the dock by at least 16px.
 *
 * Sizing per shell §4:
 *   mobile (<640px)    full-width minus 16px gutter, full-height minus dock + 16px
 *   tablet (640–1024)  90vw / max 800px, 88vh, centered
 *   desktop (>1024)    80vw / min 1024px / max 1440px, 84vh / min 600px / max 920px
 *   wide (>1600)       1440px x 920px
 *
 * The pane is a 2-row vertical flex: a sticky header (PaneHeader, 56px)
 * over a scrollable body. Apps own their body content entirely.
 *
 * Content swap (route change) is animated by the `pane-content-in`
 * keyframes via the `animate-pane-content-in` class on the body — the
 * pane container itself does not reanimate, the wallpaper and dock are
 * untouched, the operator experiences the OS, not the website.
 *
 * See: synap-team-docs/content/team/platform/eve-os-shell.mdx §4
 */

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useCompanionStore } from "../stores/companion-store";

export interface PaneProps {
  children: ReactNode;
}

export function Pane({ children }: PaneProps) {
  // Re-key the body on every route so React mounts a fresh subtree —
  // that re-fires the entrance animation declared via Tailwind keyframes.
  //
  // NOTE: positioning (centering, gutters, dock clearance) is now owned
  // by `PaneCompanionRow` so the optional companion can live as a flex
  // peer in the same row. The Pane only renders the frosted surface.
  //
  // When the companion is open the pane's min-width clamps are relaxed
  // so the flex row can shrink the pane to make room — otherwise its
  // 960px min would push the companion off-screen on smaller displays.
  const pathname = usePathname();
  const companionOpen = useCompanionStore((s) => s.open);
  const sizingClasses = companionOpen
    ? "sm:max-w-[min(820px,90vw)] md:max-w-[min(1280px,82vw)]"
    : "sm:max-w-[min(820px,90vw)] md:max-w-[min(1280px,82vw)] md:min-w-[min(960px,90vw)]";
  return (
    <main
      className={`
        pane-container
        os-pane
        flex w-full min-w-0 max-w-[1280px] flex-col overflow-hidden
        h-[calc(100vh-6.5rem)] sm:h-[86vh] md:h-[82vh]
        md:min-h-[600px] md:max-h-[880px]
        ${sizingClasses}
      `}
    >
      <div
        key={pathname}
        className="flex min-h-0 flex-1 flex-col animate-pane-content-in"
      >
        {children}
      </div>
    </main>
  );
}
