"use client";

/**
 * `Dock` — Layer 3 of the Eve OS shell.
 *
 * A persistent rounded pill at the bottom of the viewport that lists
 * core apps + user pins + a `+` terminator. Hugs content (max 80vw),
 * scrolls horizontally if the operator pins many apps.
 *
 * Apps are looked up via `useDockApps()` so the source of truth for
 * what appears here lives in one place.
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
        px-3 py-2.5
      "
    >
      {apps.map(app => (
        <DockIcon key={app.id} app={app} active={isActive(app.path)} />
      ))}
      <span
        className="mx-0.5 h-7 w-px shrink-0 bg-white/10"
        aria-hidden
      />
      <AddAppButton />
    </nav>
  );
}
