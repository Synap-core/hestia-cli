"use client";

/**
 * `useRunningApps` — surfaces currently-running embedded apps so the dock can
 * show a "running" indicator dot under their icon.
 *
 * Two sources are merged:
 *   1. Companion store — if a side-docked companion is open, the app that
 *      backs it (currently always `openwebui`) is considered running.
 *   2. Pathname — if the current route is `/apps/<id>?name=…&url=…`, that
 *      embedded app is considered running.
 *
 * Metadata enrichment (slug, iconUrl) is best-effort: we look up the id in
 * `pinnedApps` first; otherwise the dock will fall back to brand-colors by
 * slug. We intentionally do NOT hit `/api/components` here — too expensive
 * for a hook that re-evaluates on every navigation.
 */

import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useCompanionStore } from "../stores/companion-store";
import { usePinContext } from "./pin-context";

export interface RunningApp {
  id: string;
  name: string;
  slug: string;
  /** Launch path — same shape as `DockApp.path` (full `/apps/<id>?...` route). */
  url: string;
  iconUrl?: string | null;
}

/** App IDs that run as a side-docked Companion (mirror of dock-icon's set). */
const COMPANION_APP_IDS_BY_KIND: Record<"ai-chat", string> = {
  "ai-chat": "openwebui",
};

export function useRunningApps(): RunningApp[] {
  const pathname = usePathname();
  const { pinnedApps } = usePinContext();
  const companionOpen = useCompanionStore((s) => s.open);
  const companionKind = useCompanionStore((s) => s.kind);
  const companionPayload = useCompanionStore((s) => s.payload);

  // `searchParams` from `next/navigation` is only available in client components
  // that opt into it, but we just need the query string on the current location.
  // Track it via a small effect so SSR doesn't blow up.
  const [search, setSearch] = useState<string>("");
  useEffect(() => {
    if (typeof window === "undefined") return;
    setSearch(window.location.search);
  }, [pathname]);

  return useMemo<RunningApp[]>(() => {
    const out: RunningApp[] = [];

    // 1. Companion-driven running app.
    if (companionOpen && companionKind && companionPayload) {
      const id = COMPANION_APP_IDS_BY_KIND[companionKind];
      if (id) {
        const pinned = pinnedApps.find((a) => a.id === id || a.slug === id);
        out.push({
          id,
          name: companionPayload.title ?? pinned?.name ?? "Chat",
          slug: pinned?.slug ?? id,
          url: pinned?.url ?? companionPayload.url ?? "",
          iconUrl: pinned?.iconUrl ?? null,
        });
      }
    }

    // 2. Pathname-driven running app: `/apps/<id>?name=…&url=…`.
    const match = pathname?.match(/^\/apps\/([^/?#]+)/);
    if (match) {
      const id = decodeURIComponent(match[1]);
      if (!out.some((a) => a.id === id)) {
        const params = new URLSearchParams(search);
        const queryUrl = params.get("url") ?? "";
        const queryName = params.get("name") ?? "";
        const pinned = pinnedApps.find((a) => a.id === id || a.slug === id);
        // Re-create the dock-launch URL shape so the indicator click behaves
        // identically whether the app was pinned or opened ad-hoc.
        const launchUrl =
          pinned?.url ??
          (queryUrl
            ? `/apps/${encodeURIComponent(id)}?${new URLSearchParams({
                name: queryName || id,
                url: queryUrl,
              }).toString()}`
            : `/apps/${encodeURIComponent(id)}`);
        out.push({
          id,
          name: pinned?.name ?? queryName ?? id,
          slug: pinned?.slug ?? id,
          url: launchUrl,
          iconUrl: pinned?.iconUrl ?? null,
        });
      }
    }

    return out;
  }, [pathname, search, pinnedApps, companionOpen, companionKind, companionPayload]);
}
