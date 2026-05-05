"use client";

/**
 * Eve OS Home — `/`
 *
 * The UmbrelOS-style app launcher rendered inside the popup pane.
 * Composition (top → bottom):
 *
 *   • GreetingRow — greeting block + 3 compact stat squares on a single row
 *   • CpAuthBanner — only when CP token is missing/expired
 *   • AppGrid — vivid 2.5D app icons (premium pressed-glass)
 *   • SearchBar — capsule search at the bottom (Cmd+K)
 *
 * Concentric corner radii are mandatory inside the pane:
 *   pane radius (32) − body gutter (20) = inner card radius (12)
 *
 * The pane chrome (frosted glass, dock, wallpaper) is owned by the
 * shell at `app/(os)/layout.tsx`. This page just fills the body.
 *
 * See: synap-team-docs/content/team/platform/eve-os-home-design.mdx
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@heroui/react";
import { Settings as SettingsIcon } from "lucide-react";
import { CpAuthBanner } from "../components/cp-auth-banner";
import { PaneHeader } from "./components/pane-header";
import { GreetingRow } from "./components/greeting-row";
import { AppGrid } from "./components/app-grid";
import { SearchBar } from "./components/search-bar";
import { EmptyState } from "./components/empty-state";
import { useHomeApps } from "./hooks/use-home-apps";
import { CP_BASE_URL } from "./lib/cp-oauth";

// Until the synap-landing /marketplace ships, the "Browse marketplace"
// link points back to the CP. This is the single source of truth for
// every "open marketplace" affordance on the Home.
const MARKETPLACE_URL = `${CP_BASE_URL}/marketplace`;

export default function HomePage() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const { apps, isLoading, bannerState, refetch } = useHomeApps();

  // Filter is name + description + category — case-insensitive contains.
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
          <Button
            isIconOnly
            variant="light"
            size="sm"
            radius="full"
            aria-label="Open settings"
            onPress={() => router.push("/settings")}
            className="text-foreground/55 hover:text-foreground"
          >
            <SettingsIcon className="h-4 w-4" strokeWidth={2} />
          </Button>
        }
      />

      {/* Body — 20px outer gutter holds the concentric radius rule
          (pane 32 − gutter 20 = inner card radius 12). */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pb-5 pt-4 sm:px-6 sm:pt-5">
        {showBanner && (
          <div className="mb-4">
            <CpAuthBanner state={bannerState} onRetry={refetch} />
          </div>
        )}

        <GreetingRow />

        {showColdEmpty ? (
          <EmptyState />
        ) : (
          <div className="mt-6 min-h-0 flex-1">
            {noResultsForSearch ? (
              <p className="px-2 py-12 text-center text-[13px] text-foreground/55">
                No apps match{" "}
                <span className="font-medium text-foreground">&ldquo;{query}&rdquo;</span>.
                Try clearing the search or browse the marketplace from the{" "}
                <span className="text-foreground/40">+</span> tile.
              </p>
            ) : (
              <AppGrid
                apps={filtered}
                isLoading={isLoading}
                marketplaceUrl={MARKETPLACE_URL}
              />
            )}
          </div>
        )}

        <SearchBar value={query} onChange={setQuery} />
      </div>
    </>
  );
}
