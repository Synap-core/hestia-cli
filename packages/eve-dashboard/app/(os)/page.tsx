"use client";

/**
 * Eve OS Home — `/`
 *
 * The UmbrelOS-style app launcher rendered inside the popup pane.
 * Composition (top → bottom):
 *
 *   • PaneHeader — greeting + stats + sign-in/settings on ONE row
 *   • Body
 *       – Error banner (only when marketplace is unreachable)
 *       – AppGrid — vivid 2.5D app icons (premium pressed-glass)
 *       – SearchBar — capsule search at the bottom (Cmd+K)
 *
 * The header consolidation saves ~140px of vertical real estate that
 * was wasted on the old two-row greeting + standalone auth banner.
 * Free apps from the public marketplace catalog still render even when
 * the operator hasn't signed in — the Sign-in button in the header is
 * the affordance for unlocking entitled-only apps.
 *
 * Concentric corner radii are mandatory inside the pane:
 *   pane radius (32) − body gutter (20) = inner card radius (12)
 *
 * The pane chrome (frosted glass, dock, wallpaper) is owned by the
 * shell at `app/(os)/layout.tsx`. This page just fills the body.
 *
 * See: synap-team-docs/content/team/platform/eve-os-home-design.mdx
 */

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@heroui/react";
import {
  Settings as SettingsIcon,
  LogIn,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";
import { PaneHeader } from "./components/pane-header";
import {
  HomeGreeting,
  HomeStatPills,
} from "./components/home-header-content";
import { AppGrid } from "./components/app-grid";
import { SearchBar } from "./components/search-bar";
import { EmptyState } from "./components/empty-state";
import { useHomeApps } from "./hooks/use-home-apps";
import { initiateCpOAuth } from "./lib/cp-oauth";

export default function HomePage() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const { apps, isLoading, bannerState, refetch } = useHomeApps();

  // Filter is name + description + category — case-insensitive contains.
  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return apps;
    return apps.filter((a) =>
      a.name.toLowerCase().includes(q) ||
      (a.description?.toLowerCase().includes(q) ?? false) ||
      a.category.toLowerCase().includes(q),
    );
  }, [query, apps]);

  // initiateCpOAuth() navigates the page on success. If it throws (CP
  // unreachable, crypto unavailable, etc.) the page never navigates and
  // we'd previously be silent. Surface the error inline instead.
  const handleSignIn = useCallback(async () => {
    setAuthError(null);
    try {
      await initiateCpOAuth();
      // If we're still here after this resolves, the navigation didn't
      // start — set a hint so the user isn't left wondering.
      window.setTimeout(() => {
        if (document.visibilityState !== "hidden") {
          setAuthError(
            "Couldn't reach Synap. Check your network or the CP base URL.",
          );
        }
      }, 1500);
    } catch (e) {
      setAuthError(
        e instanceof Error ? e.message : "Couldn't start sign-in",
      );
    }
  }, []);

  const isSignedOut = bannerState.kind === "signed-out";
  const isErrorBanner = bannerState.kind === "error";
  const noResultsForSearch =
    !isLoading && filtered.length === 0 && query.length > 0;
  const showColdEmpty =
    !isLoading && apps.length === 0 && query.length === 0;

  return (
    <>
      <PaneHeader
        actions={
          <>
            <HomeStatPills />
            {isSignedOut && (
              <Button
                size="sm"
                radius="full"
                color="primary"
                variant="flat"
                startContent={<LogIn className="h-3.5 w-3.5" />}
                onPress={() => void handleSignIn()}
                className="ml-1 font-medium"
              >
                Sign in
              </Button>
            )}
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
          </>
        }
      >
        <HomeGreeting />
      </PaneHeader>

      {/* Body — 20px outer gutter holds the concentric radius rule
          (pane 32 − gutter 20 = inner card radius 12). */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pb-5 pt-4 sm:px-6 sm:pt-5">
        {(isErrorBanner || authError) && (
          <div className="mb-3">
            <InlineErrorBanner
              message={
                authError ??
                (bannerState.kind === "error"
                  ? `Couldn't reach marketplace${
                      bannerState.message ? ` — ${bannerState.message}` : ""
                    }`
                  : "")
              }
              onRetry={authError ? () => setAuthError(null) : refetch}
              retryLabel={authError ? "Dismiss" : "Retry"}
            />
          </div>
        )}

        {showColdEmpty ? (
          <EmptyState />
        ) : (
          <div className="min-h-0 flex-1">
            {noResultsForSearch ? (
              <p className="px-2 py-12 text-center text-[13px] text-foreground/55">
                No apps match{" "}
                <span className="font-medium text-foreground">
                  &ldquo;{query}&rdquo;
                </span>
                . Try clearing the search or browse the marketplace from the{" "}
                <span className="text-foreground/40">+</span> tile.
              </p>
            ) : (
              <AppGrid
                apps={filtered}
                isLoading={isLoading}
                marketplaceUrl="/marketplace"
              />
            )}
          </div>
        )}

        <SearchBar value={query} onChange={setQuery} />
      </div>
    </>
  );
}

// ─── Inline error banner ─────────────────────────────────────────────────────

function InlineErrorBanner({
  message,
  onRetry,
  retryLabel,
}: {
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <div
      className="
        flex flex-row items-center gap-3 rounded-lg
        bg-warning/10 px-4 py-2.5
        border border-warning/30
      "
    >
      <AlertTriangle
        className="h-4 w-4 shrink-0 text-warning"
        strokeWidth={2}
        aria-hidden
      />
      <p className="flex-1 min-w-0 text-[13px] text-foreground">{message}</p>
      {onRetry && (
        <Button
          size="sm"
          radius="full"
          color="warning"
          variant="flat"
          startContent={<RefreshCw className="h-3 w-3" />}
          onPress={onRetry}
          className="font-medium"
        >
          {retryLabel ?? "Retry"}
        </Button>
      )}
    </div>
  );
}
