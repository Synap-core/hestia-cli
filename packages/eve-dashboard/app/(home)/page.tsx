"use client";

/**
 * Eve OS Home — `/`
 *
 * The UmbrelOS-style app launcher. This is what the operator sees the
 * moment they open Eve. One job: launch apps. Everything else (config,
 * agents, intents) is one click away in the sidebar.
 *
 * Composition (top → bottom):
 *
 *   • TopBar      — search · settings · avatar
 *   • CpAuthBanner — only when we couldn't reach the marketplace
 *   • Greeting    — "Good evening" + date/time (hidden < 768px)
 *   • AppGrid     — square tiles, marketplace + local components merged
 *   • EmptyState  — only when there are zero apps to show
 *   • ChannelBar  — sticky bottom, channel status dots
 *
 * The auth middleware (`proxy.ts`) already gates this route — if no
 * `eve-session` cookie is present, the user is bounced to `/login`
 * before this component even renders. We don't reinvent that here.
 *
 * The CP banner is a *separate* concern from local-dashboard auth: it
 * surfaces missing/expired Synap CP tokens (used to fetch the
 * marketplace catalog). The page still renders fully without it,
 * showing only the local components.
 */

import { useMemo, useState } from "react";
import { CpAuthBanner } from "../components/cp-auth-banner";
import { TopBar } from "./components/top-bar";
import { Greeting } from "./components/greeting";
import { AppGrid } from "./components/app-grid";
import { EmptyState } from "./components/empty-state";
import { ChannelBar } from "./components/channel-bar";
import { useHomeApps } from "./hooks/use-home-apps";

export default function HomePage() {
  const [query, setQuery] = useState("");
  const { apps, isLoading, bannerState, refetch } = useHomeApps();

  // Filter is name + description + category — case-insensitive contains.
  // Fast enough for hundreds of apps; revisit if catalogs grow.
  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return apps;
    return apps.filter(a => {
      return (
        a.name.toLowerCase().includes(q) ||
        (a.description?.toLowerCase().includes(q) ?? false) ||
        a.category.toLowerCase().includes(q)
      );
    });
  }, [query, apps]);

  const showBanner = bannerState.kind !== "working";
  const showGreeting = !showBanner;
  const grid = filtered.length > 0 || isLoading;
  const showEmpty = !isLoading && filtered.length === 0 && !query;

  return (
    <div className="flex min-h-[calc(100vh-2rem)] flex-col">
      <TopBar onSearch={setQuery} />

      {showBanner && (
        <div className="mt-4">
          <CpAuthBanner state={bannerState} onRetry={refetch} />
        </div>
      )}

      {showGreeting && <Greeting />}

      <main className="flex-1 mt-2">
        {grid && <AppGrid apps={filtered} isLoading={isLoading} />}

        {/* No-results-for-search hint — separate from the cold EmptyState
            so users typing a typo don't see "your OS is a blank canvas". */}
        {!isLoading && filtered.length === 0 && query && (
          <p className="py-12 text-center text-sm text-default-500">
            No apps match{" "}
            <span className="text-foreground font-medium">&ldquo;{query}&rdquo;</span>
            . Try clearing the search, or browse the marketplace from the
            <span className="text-default-400"> + </span>tile.
          </p>
        )}

        {showEmpty && <EmptyState />}
      </main>

      <ChannelBar />
    </div>
  );
}
