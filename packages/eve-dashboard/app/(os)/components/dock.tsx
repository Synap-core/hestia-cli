"use client";

/**
 * `Dock` — Layer 3 of the Eve OS shell.
 *
 * Persistent rounded pill at the bottom of the viewport. Hugs content
 * (max 80vw), scrolls horizontally if the operator pins many apps.
 *
 * Padding is calculated so a 40×40 icon clears the pill edge by ~10px
 * top/bottom (the visionOS-style ratio). All icons are identical sized
 * — including the `+` terminator — for a tidy aligned row.
 *
 * See: synap-team-docs/content/team/platform/eve-os-shell.mdx §5
 */

import { usePathname } from "next/navigation";
import { DockIcon } from "./dock-icon";
import { AddAppButton } from "./add-app-button";
import { useDockApps } from "./use-dock-apps";

export function Dock() {
  const apps = useDockApps();
  const pathname = usePathname();

  function isActive(path: string): boolean {
    if (path === "/") return pathname === "/";
    return pathname === path || pathname?.startsWith(path + "/") || false;
  }

  return (
    <nav
      aria-label="Application dock"
      className="
        os-dock
        fixed bottom-5 left-1/2 z-20 -translate-x-1/2
        flex max-w-[80vw] items-center gap-2 overflow-x-auto
        px-2.5 py-2.5
      "
    >
      {apps.map(app => (
        <DockIcon
          key={app.id}
          app={app}
          active={isActive(app.path)}
          unpinnable={app.kind === "pinned"}
        />
      ))}
      <span
        className="mx-0.5 h-6 w-px shrink-0 bg-foreground/10"
        aria-hidden
      />
      <AddAppButton />
    </nav>
  );
}
