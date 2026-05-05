"use client";

/**
 * Eve OS — In-OS Marketplace (`/marketplace`).
 *
 * Catalog page that lives inside the same Pane as Home. Pulls the same
 * `/api/marketplace/apps` feed used by `useHomeApps`, but renders ALL
 * published apps regardless of entitlement so the user can install
 * something new from here.
 *
 * Composition:
 *   • PaneHeader with a back button → /
 *   • CpAuthBanner when the user isn't signed in to CP
 *   • Category tab strip (HeroUI Tabs)
 *   • SearchBar (re-uses Home's capsule)
 *   • Card grid: glass-icon + name + pitch + InstallButton + meta
 *
 * Concentric radii (per project rule):
 *   pane 32 → outer gutter 20 → card 12 → glyph 9
 *
 * Auth: cpFetch handles 401 by surfacing the banner; the install button
 * also degrades gracefully on auth loss.
 *
 * See: synap-team-docs/content/team/platform/eve-os-roadmap.mdx M5
 */

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Card,
  Chip,
  Input,
  Spinner,
  Tabs,
  Tab,
} from "@heroui/react";
import { Search, Package } from "lucide-react";
import { CpAuthBanner, type CpAuthBannerState } from "../../components/cp-auth-banner";
import { PaneHeader } from "../components/pane-header";
import { brandColorFor } from "../lib/brand-colors";
import {
  CpUnauthorizedError,
  fetchMarketplaceApps,
  MarketplaceError,
  type MarketplaceAppWithEntitlement,
} from "../lib/marketplace-client";
import { InstallButton } from "./components/install-button";

const CATEGORIES = [
  { key: "all",             label: "All" },
  { key: "productivity",    label: "Productivity" },
  { key: "ai",              label: "AI" },
  { key: "sales",           label: "Sales" },
  { key: "developer-tools", label: "Developer" },
];

function pricingChip(p: MarketplaceAppWithEntitlement["pricing"]): string {
  if (!p || p.model === "free") return "Free";
  if (p.model === "subscription" && p.amount) {
    const each = p.interval === "year" ? "yr" : "mo";
    return `${p.amount} ${p.currency ?? "EUR"}/${each}`;
  }
  if (p.model === "one_time" && p.amount) {
    return `${p.amount} ${p.currency ?? "EUR"}`;
  }
  return "Paid";
}

export default function MarketplacePage() {
  return (
    <Suspense fallback={<MarketplacePageFallback />}>
      <MarketplacePageInner />
    </Suspense>
  );
}

function MarketplacePageFallback() {
  return (
    <>
      <PaneHeader title="Marketplace" />
      <div className="flex flex-1 items-center justify-center py-16">
        <Spinner size="md" />
      </div>
    </>
  );
}

function MarketplacePageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Handoff from synap.live/marketplace/install/<slug>: scrolls + highlights
  // the app row. We only auto-scroll once per page load — subsequent renders
  // (e.g. after install completes) shouldn't yank the viewport.
  const installSlug = searchParams.get("install");
  const [apps, setApps] = useState<MarketplaceAppWithEntitlement[]>([]);
  const [bannerState, setBannerState] = useState<CpAuthBannerState>({ kind: "working" });
  const [isLoading, setIsLoading] = useState(true);
  const [category, setCategory] = useState<string>("all");
  const [query, setQuery] = useState("");
  const handoffScrolledRef = useRef(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetchMarketplaceApps({
        // Render banner instead of forcing OAuth redirect.
        onUnauthorized: () => { /* banner handles it */ },
      });
      setApps(res.apps);
      setBannerState({ kind: "working" });
    } catch (err) {
      if (err instanceof CpUnauthorizedError) {
        setBannerState({ kind: "signed-out" });
      } else if (err instanceof MarketplaceError) {
        setBannerState({ kind: "error", message: err.message });
      } else {
        setBannerState({
          kind: "error",
          message: err instanceof Error ? err.message : "Marketplace unreachable",
        });
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Handoff scroll-into-view. Runs once after the catalog loads and a
  // `?install=<slug>` is present. Doesn't auto-click install (would bypass
  // confirmation) — just brings the right card into view + flashes a ring.
  useEffect(() => {
    if (handoffScrolledRef.current) return;
    if (!installSlug || isLoading) return;
    const el = document.querySelector<HTMLElement>(`[data-app-slug="${CSS.escape(installSlug)}"]`);
    if (!el) return;
    handoffScrolledRef.current = true;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("ring-2", "ring-primary/60");
    setTimeout(() => el.classList.remove("ring-2", "ring-primary/60"), 2400);
  }, [installSlug, isLoading, apps]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    return apps.filter(a => {
      if (a.status !== "published") return false;
      if (category !== "all" && a.category !== category) return false;
      if (!q) return true;
      const hay = `${a.name} ${a.description ?? ""} ${a.category}`.toLowerCase();
      return hay.includes(q);
    });
  }, [apps, category, query]);

  return (
    <>
      <PaneHeader
        title="Marketplace"
        back={() => router.push("/")}
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pb-6 pt-4 sm:px-6 sm:pt-5">
        {bannerState.kind !== "working" && (
          <div className="mb-4">
            <CpAuthBanner state={bannerState} onRetry={load} />
          </div>
        )}

        {/* Hero — short, doesn't dominate */}
        <header className="mb-4 flex items-baseline justify-between gap-4">
          <div>
            <h1 className="text-[22px] font-medium tracking-tight text-foreground">
              App Marketplace
            </h1>
            <p className="text-[13px] text-foreground/55">
              Sovereign apps that run on your pod.
            </p>
          </div>
          <Chip
            size="sm"
            variant="flat"
            color="default"
            startContent={<Package className="ml-1 h-3 w-3" strokeWidth={2.2} />}
          >
            {filtered.length}
          </Chip>
        </header>

        {/* Filters row */}
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          <Tabs
            aria-label="Filter by category"
            variant="underlined"
            size="sm"
            selectedKey={category}
            onSelectionChange={(k) => setCategory(String(k))}
            className="-mb-px"
          >
            {CATEGORIES.map(c => (
              <Tab key={c.key} title={c.label} />
            ))}
          </Tabs>
          <div className="sm:ml-auto sm:max-w-[260px]">
            <Input
              size="sm"
              radius="full"
              variant="flat"
              placeholder="Search apps…"
              value={query}
              onValueChange={setQuery}
              startContent={<Search className="h-3.5 w-3.5 text-foreground/45" />}
              spellCheck="false"
            />
          </div>
        </div>

        {/* Grid */}
        {isLoading ? (
          <div className="flex flex-1 items-center justify-center py-16">
            <Spinner size="md" />
          </div>
        ) : filtered.length === 0 ? (
          <p className="py-12 text-center text-[13px] text-foreground/55">
            {apps.length === 0
              ? "No apps reachable. Check your CP connection."
              : "No apps match this filter."}
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map(app => (
              <MarketplaceCard
                key={app.id}
                app={app}
                onInstalled={load}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

// ─── Card ────────────────────────────────────────────────────────────────────

function MarketplaceCard({
  app,
  onInstalled,
}: {
  app: MarketplaceAppWithEntitlement;
  onInstalled: () => void;
}) {
  const palette = brandColorFor(app.slug);

  return (
    <Card
      isBlurred
      shadow="none"
      radius="md"
      data-app-slug={app.slug}
      className="
        flex flex-col gap-3 p-4
        bg-foreground/[0.04]
        ring-1 ring-inset ring-foreground/10
        transition-colors hover:bg-foreground/[0.07]
      "
    >
      <div className="flex items-start gap-3">
        {/* Glass icon — concentric: card 12 → glyph 8 (Tailwind rounded-lg). */}
        <span
          className="
            glass-icon
            flex h-12 w-12 shrink-0 items-center justify-center
            rounded-lg
          "
          style={{ background: palette.bg }}
          aria-hidden
        >
          {app.iconUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={app.iconUrl}
              alt=""
              width={28}
              height={28}
              className="rounded-md"
            />
          ) : (
            <span className="text-[18px] font-medium text-white/95">
              {app.name.charAt(0).toUpperCase()}
            </span>
          )}
        </span>

        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[15px] font-medium leading-tight text-foreground">
            {app.name}
          </h3>
          <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-snug text-foreground/65">
            {app.description ?? ""}
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-[11px] text-foreground/55">
          <span>{app.category}</span>
          <span className="text-foreground/30">·</span>
          <span>{pricingChip(app.pricing)}</span>
          {app.installCount > 0 && (
            <>
              <span className="text-foreground/30">·</span>
              <span>{app.installCount} installs</span>
            </>
          )}
        </div>

        <InstallButton app={app} onInstalled={onInstalled} />
      </div>
    </Card>
  );
}
