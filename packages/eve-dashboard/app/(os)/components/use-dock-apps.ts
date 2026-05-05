"use client";

/**
 * `useDockApps` — merges core apps + user-pinned + marketplace contributions
 * into the persistent dock.
 *
 * The dock is what the operator uses to switch apps. v1 pins three core
 * apps (Home, Agents, Settings) plus whichever apps the operator
 * explicitly pinned from the Home grid via the contextual menu. v1 does
 * not surface every installed app on the dock — that's what the Home
 * grid is for.
 *
 * For Phase 2A we just hard-code the core apps. Pinning persistence
 * (`~/.eve/preferences.json` `home.pinnedAppIds`) wires up alongside the
 * Home rebuild — the hook returns an empty `pinned` array until that
 * lands.
 *
 * See: synap-team-docs/content/team/platform/eve-os-shell.mdx §5
 */

import { useMemo } from "react";

export interface DockApp {
  id: string;
  /** Brand-color registry key (see `lib/brand-colors.ts`). */
  slug: string;
  /** Display name (used in tooltip). */
  name: string;
  /** Path the dock click navigates to. Only same-origin paths supported. */
  path: string;
  /** Distinguishes the seeded core apps (cannot be unpinned) from pins. */
  kind: "core" | "pinned";
}

const CORE_APPS: DockApp[] = [
  { id: "home",     slug: "home",     name: "Home",     path: "/",         kind: "core" },
  { id: "agents",   slug: "agents",   name: "Agents",   path: "/agents",   kind: "core" },
  { id: "settings", slug: "settings", name: "Settings", path: "/settings", kind: "core" },
];

export function useDockApps(): DockApp[] {
  // Pinning persistence ships with the Home rebuild — v1 dock is just
  // the three core apps. Returning a memoized constant keeps the dock
  // referentially stable across renders.
  return useMemo(() => CORE_APPS.slice(), []);
}
