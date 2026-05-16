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

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@heroui/react";
import {
  Settings as SettingsIcon,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";
import { PaneHeader } from "./components/pane-header";
import {
  AccountAvatar,
  HomeGreeting,
  HomeStatPills,
} from "./components/home-header-content";
import { ConnectionIndicator } from "./components/connection-indicator";
import { AppGrid } from "./components/app-grid";
import { SearchBar } from "./components/search-bar";
import { EmptyState } from "./components/empty-state";
import { useHomeApps } from "./hooks/use-home-apps";
import { useStats } from "./hooks/use-stats";
import { usePodPairing } from "./hooks/use-pod-pairing";
import { PodPairDialog } from "./components/pod-pair-dialog";
import { EveAccountGate } from "./components/auth/EveAccountGate";
import { PodConnectGate } from "./components/auth/PodConnectGate";

export default function HomePage() {
  return (
    <EveAccountGate>
      <PodConnectGate>
        <HomeContent />
      </PodConnectGate>
    </EveAccountGate>
  );
}

function HomeContent() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [isPairDialogOpen, setIsPairDialogOpen] = useState(false);
  const { apps, isLoading, bannerState, refetch } = useHomeApps();
  const { stats } = useStats();
  const {
    state: pairingState,
    userEmail: pairedEmail,
    refetch: refetchPairing,
  } = usePodPairing();

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
            <HomeStatPills
              pairingState={pairingState}
              onPairPod={() => setIsPairDialogOpen(true)}
            />
            <ConnectionIndicator onClick={() => setIsPairDialogOpen(true)} />
            <AccountAvatar />
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
        {isErrorBanner && (
          <div className="mb-3">
            <InlineErrorBanner
              message={
                bannerState.kind === "error"
                  ? `Couldn't reach marketplace${
                      bannerState.message ? ` — ${bannerState.message}` : ""
                    }`
                  : ""
              }
              onRetry={refetch}
              retryLabel="Retry"
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
                coreCounts={{ proposals: stats.inboxPending }}
              />
            )}
          </div>
        )}

        <SearchBar value={query} onChange={setQuery} />
      </div>

      <PodPairDialog
        isOpen={isPairDialogOpen}
        onClose={() => setIsPairDialogOpen(false)}
        defaultEmail={pairedEmail}
        onSuccess={() => {
          // Token is freshly minted — repaint the header pill cluster
          // and refetch the launcher so per-user entitled apps appear.
          refetchPairing();
          refetch();
        }}
      />
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
