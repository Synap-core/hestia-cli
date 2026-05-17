"use client";

/**
 * `useDockApps` — merges core apps + user-pinned apps + running apps into
 * the dock list.
 *
 * Core apps (Home, Agents, Settings) are always first and cannot be removed.
 * Pinned apps are loaded from `~/.eve/preferences.json` via the
 * `/api/preferences/home` endpoint, managed by `PinContextProvider`.
 * Running apps (from `useRunningApps()`) are appended last; pinned-and-running
 * apps stay in their pin slot but carry a `running: true` flag so the dock
 * can render the running dot indicator.
 *
 * See: synap-team-docs/content/team/platform/eve-os-shell.mdx §5
 */

import { useMemo } from "react";
import { usePinContext } from "./pin-context";
import { useRunningApps } from "./use-running-apps";

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
  kind: "core" | "pinned" | "running";
  /**
   * True when the app has an open surface (companion or `/apps/<id>` route).
   * Always true for `kind: "running"`; may also be true on `kind: "pinned"`.
   */
  running?: boolean;
}

const CORE_APPS: DockApp[] = [
  { id: "home",     slug: "home",     name: "Home",     path: "/",         kind: "core" },
  { id: "agents",   slug: "agents",   name: "Agents",   path: "/agents",   kind: "core" },
  { id: "settings", slug: "settings", name: "Settings", path: "/settings", kind: "core" },
];

export function useDockApps(): DockApp[] {
  const { pinnedApps } = usePinContext();
  const runningApps = useRunningApps();

  return useMemo(() => {
    const runningIds = new Set(runningApps.map((a) => a.id));
    const coreIds = new Set(CORE_APPS.map((a) => a.id));
    const pinnedIds = new Set(pinnedApps.map((a) => a.id));

    const core: DockApp[] = CORE_APPS.map((a) => ({
      ...a,
      running: runningIds.has(a.id),
    }));

    const pinned: DockApp[] = pinnedApps.map((a) => ({
      id: a.id,
      slug: a.slug,
      name: a.name,
      path: a.url,
      iconUrl: a.iconUrl,
      kind: "pinned" as const,
      running: runningIds.has(a.id),
    }));

    const runningOnly: DockApp[] = runningApps
      .filter((a) => !coreIds.has(a.id) && !pinnedIds.has(a.id))
      .map((a) => ({
        id: a.id,
        slug: a.slug,
        name: a.name,
        path: a.url,
        iconUrl: a.iconUrl,
        kind: "running" as const,
        running: true,
      }));

    return [...core, ...pinned, ...runningOnly];
  }, [pinnedApps, runningApps]);
}
