"use client";

/**
 * Eve OS Home — `/`
 *
 * The UmbrelOS-style app launcher rendered inside the popup pane.
 * Four vertical zones (top → bottom):
 *
 *   • Greeting     — wordless pane header + "Good evening" + date
 *   • Stat cards   — agents running / events today / updates available
 *   • App grid     — vivid colorful icons (NOT gray tiles)
 *   • Search       — capsule search at the bottom (Cmd+K)
 *
 * The pane chrome (frosted glass, dock, wallpaper) is owned by the
 * shell at `app/(os)/layout.tsx` — this page just fills the body.
 *
 * See: synap-team-docs/content/team/platform/eve-os-home-design.mdx
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { Settings as SettingsIcon } from "lucide-react";
import { CpAuthBanner } from "../components/cp-auth-banner";
import { PaneHeader } from "./components/pane-header";
import { Greeting } from "./components/greeting";
import { StatCards } from "./components/stat-cards";
import { AppGrid } from "./components/app-grid";
import { SearchBar } from "./components/search-bar";
import { EmptyState } from "./components/empty-state";
import { useHomeApps } from "./hooks/use-home-apps";

export default function HomePage() {
  const [query, setQuery] = useState("");
  const { apps, isLoading, bannerState, refetch } = useHomeApps();

  // Filter is name + description + category — case-insensitive contains.
  // Fast at hundreds of apps; revisit if catalogs grow.
  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return apps;
    return apps.filter(a =>
      a.name.toLowerCase().includes(q) ||
      (a.description?.toLowerCase().includes(q) ?? false) ||
      a.category.toLowerCase().includes(q),
    );
  }, [query, apps]);

  const showBanner = bannerState.kind !== "working";
  const noResultsForSearch = !isLoading && filtered.length === 0 && query.length > 0;
  const showColdEmpty = !isLoading && apps.length === 0 && query.length === 0;

  return (
    <>
      <PaneHeader
        actions={
          <Link
            href="/settings"
            aria-label="Open settings"
            className="
              inline-flex h-8 w-8 items-center justify-center rounded-full
              text-default-500 hover:text-foreground hover:bg-white/5
              transition-colors
            "
          >
            <SettingsIcon className="h-4 w-4" />
          </Link>
        }
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {/* Auth banner — sits above everything else when CP token is missing. */}
        {showBanner && (
          <div className="px-6 pt-4">
            <CpAuthBanner state={bannerState} onRetry={refetch} />
          </div>
        )}

        <Greeting />

        {!showColdEmpty && <StatCards />}

        {/* App grid takes whatever room is left between stat strip and search. */}
        {showColdEmpty ? (
          <EmptyState />
        ) : (
          <div className="mt-6 min-h-0 flex-1">
            {noResultsForSearch ? (
              <p className="px-6 py-12 text-center text-sm text-default-500">
                No apps match{" "}
                <span className="font-medium text-foreground">&ldquo;{query}&rdquo;</span>.
                Try clearing the search or browse the marketplace from the
                <span className="text-default-400"> + </span> tile.
              </p>
            ) : (
              <AppGrid apps={filtered} isLoading={isLoading} />
            )}
          </div>
        )}

        {/* Sticky-ish search via flex layout — last child of body column. */}
        <SearchBar value={query} onChange={setQuery} />
      </div>
    </>
  );
}
