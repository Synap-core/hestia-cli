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

export interface PaneProps {
  children: ReactNode;
}

export function Pane({ children }: PaneProps) {
  // Re-key the body on every route so React mounts a fresh subtree —
  // that re-fires the entrance animation declared via Tailwind keyframes.
  const pathname = usePathname();
  return (
    <main className="pane-container relative z-10 flex min-h-screen items-start justify-center px-4 pt-4 pb-32 sm:pt-8 md:items-center md:pt-0">
      <div
        className="
          os-pane
          flex w-full max-w-[1440px] flex-col overflow-hidden
          h-[calc(100vh-7rem)] sm:h-[88vh] md:h-[84vh]
          md:min-h-[600px] md:max-h-[920px]
          sm:max-w-[min(800px,90vw)]
          md:max-w-[min(1440px,80vw)] md:min-w-[min(1024px,90vw)]
        "
      >
        <div
          key={pathname}
          className="flex min-h-0 flex-1 flex-col animate-pane-content-in"
        >
          {children}
        </div>
      </div>
    </main>
  );
}
