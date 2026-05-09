"use client";

/**
 * `useDockApps` — merges core apps + user-pinned apps into the dock list.
 *
 * Core apps (Home, Agents, Settings) are always first and cannot be removed.
 * Pinned apps are loaded from `~/.eve/preferences.json` via the
 * `/api/preferences/home` endpoint, managed by `PinContextProvider`.
 *
 * See: synap-team-docs/content/team/platform/eve-os-shell.mdx §5
 */

import { useMemo } from "react";
import { usePinContext } from "./pin-context";

export interface DockApp {
  id: string;
  /** Brand-color registry key (see `lib/brand-colors.ts`). */
  slug: string;
  /** Display name (used in tooltip). */
  name: string;
  /** Path the dock click navigates to. External URLs open in a new tab. */
  path: string;
  /** Remote icon URL for apps without a brand-color glyph. */
  iconUrl?: string | null;
  /** Distinguishes the seeded core apps (cannot be unpinned) from pins. */
  kind: "core" | "pinned";
}

const CORE_APPS: DockApp[] = [
  { id: "home",     slug: "home",     name: "Home",     path: "/",         kind: "core" },
  { id: "agents",   slug: "agents",   name: "Agents",   path: "/agents",   kind: "core" },
  { id: "settings", slug: "settings", name: "Settings", path: "/settings", kind: "core" },
];

export function useDockApps(): DockApp[] {
  const { pinnedApps } = usePinContext();

  return useMemo(
    () => [
      ...CORE_APPS,
      ...pinnedApps.map((a) => ({
        id: a.id,
        slug: a.slug,
        name: a.name,
        path: a.url,
        iconUrl: a.iconUrl,
        kind: "pinned" as const,
      })),
    ],
    [pinnedApps],
  );
}
