"use client";

/**
 * Eve OS — In-OS Marketplace (`/marketplace`).
 *
 * Catalog page that lives inside the same Pane as Home. Pulls TWO
 * feeds in parallel:
 *
 *   • `/api/marketplace/apps`  — published catalog from the CP
 *     (per-user entitlement when signed in, public otherwise).
 *   • `/api/components`        — locally-installed Eve components
 *     (so the per-card "Add to Eve" / "Open" affordance reflects
 *     ground truth).
 *
 * Layout:
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ Header: title + count + filters (category tabs + search)     │
 *   ├──────────────────────────────────────────────────────────────┤
 *   │ Section: "On your Eve" — eve_component apps                  │
 *   │   (running locally; "Open" + "Add to Eve" buttons)           │
 *   ├──────────────────────────────────────────────────────────────┤
 *   │ Section: "Synap apps"  — url apps                            │
 *   │   (open .synap.live in a new tab; "Open" button only)        │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * Locked apps (entitled === false) get a top-right Lock chip and a
 * dimmed body — clicking the card opens the upgrade flow instead of
 * the app URL.
 *
 * Concentric radii: pane 32 → outer gutter 20 → card 12 → glyph 8.
 *
 * See: synap-team-docs/content/team/platform/eve-os-roadmap.mdx M5
 *      synap-team-docs/content/team/platform/marketplace-landing-design.mdx §7.1
 */

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Card,
  Chip,
  Input,
  Spinner,
  Tabs,
  Tab,
} from "@heroui/react";
import { Search, Package, Lock } from "lucide-react";
import { CpAuthBanner, type CpAuthBannerState } from "../../components/cp-auth-banner";
import { PaneHeader } from "../components/pane-header";
import { brandColorFor } from "../lib/brand-colors";
import {
  CpUnauthorizedError,
  fetchMarketplaceApps,
  MarketplaceError,
  type MarketplaceAppWithEntitlement,
} from "../lib/marketplace-client";
import {
  CardActionRow,
  type LocalComponentRef,
} from "./components/card-actions";

const CATEGORIES = [
  { key: "all", label: "All" },
  { key: "productivity", label: "Productivity" },
  { key: "ai", label: "AI" },
  { key: "sales", label: "Sales" },
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

// ─── Local-component shape (mirror of /api/components response) ──────────────

interface LocalComponentRow {
  id: string;
  installed: boolean;
  containerRunning: boolean | null;
  hostPort: number | null;
  domainUrl: string | null;
}

interface ComponentsResponse {
  components: LocalComponentRow[];
}

function localComponentRef(c: LocalComponentRow): LocalComponentRef {
  return {
    installed: c.installed,
    running: c.containerRunning === true,
    url:
      c.domainUrl ??
      (c.hostPort && typeof window !== "undefined"
        ? `http://${window.location.hostname}:${c.hostPort}`
        : null),
  };
}

// ─── Page ────────────────────────────────────────────────────────────────────

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
  const installSlug = searchParams.get("install");

  const [apps, setApps] = useState<MarketplaceAppWithEntitlement[]>([]);
  const [localById, setLocalById] = useState<Record<string, LocalComponentRef>>(
    {},
  );
  const [bannerState, setBannerState] = useState<CpAuthBannerState>({
    kind: "working",
  });
  const [isLoading, setIsLoading] = useState(true);
  const [category, setCategory] = useState<string>("all");
  const [query, setQuery] = useState("");
  const handoffScrolledRef = useRef(false);

  const load = useCallback(async () => {
    setIsLoading(true);

    // Marketplace + local components run in parallel — neither blocks
    // the other. If marketplace 401s we still render the local row.
    const [marketResult, localResult] = await Promise.allSettled([
      fetchMarketplaceApps({ onUnauthorized: () => { /* banner */ } }),
      fetch("/api/components", { credentials: "include", cache: "no-store" }).then(
        (r) => (r.ok ? (r.json() as Promise<ComponentsResponse>) : null),
      ),
    ]);

    if (marketResult.status === "fulfilled") {
      setApps(marketResult.value.apps);
      setBannerState({ kind: "working" });
    } else {
      const err = marketResult.reason;
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
    }

    if (localResult.status === "fulfilled" && localResult.value) {
      const map: Record<string, LocalComponentRef> = {};
      for (const row of localResult.value.components) {
        map[row.id] = localComponentRef(row);
      }
      setLocalById(map);
    }

    setIsLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Handoff scroll-into-view from synap.live/marketplace/install/<slug>.
  useEffect(() => {
    if (handoffScrolledRef.current) return;
    if (!installSlug || isLoading) return;
    const el = document.querySelector<HTMLElement>(
      `[data-app-slug="${CSS.escape(installSlug)}"]`,
    );
    if (!el) return;
    handoffScrolledRef.current = true;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("ring-2", "ring-primary/60");
    setTimeout(() => el.classList.remove("ring-2", "ring-primary/60"), 2400);
  }, [installSlug, isLoading, apps]);

  // Filter then split by appType. eve_component → "On your Eve" row;
  // url → "Synap apps" row. workspace_pack and bundle apps are dropped
  // here because they're not user-launchable from this surface (they
  // get installed via separate flows).
  const { eveApps, synapApps } = useMemo(() => {
    const q = query.toLowerCase().trim();
    const filtered = apps.filter((a) => {
      if (a.status !== "published") return false;
      if (category !== "all" && a.category !== category) return false;
      if (!q) return true;
      const hay = `${a.name} ${a.description ?? ""} ${a.category}`.toLowerCase();
      return hay.includes(q);
    });
    const eve: typeof apps = [];
    const synap: typeof apps = [];
    for (const a of filtered) {
      if (a.appType === "eve_component") eve.push(a);
      else if (a.appType === "url") synap.push(a);
    }
    return { eveApps: eve, synapApps: synap };
  }, [apps, category, query]);

  const totalCount = eveApps.length + synapApps.length;

  return (
    <>
      <PaneHeader title="Marketplace" back={() => router.push("/")} />

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pb-6 pt-4 sm:px-6 sm:pt-5">
        {bannerState.kind !== "working" && (
          <div className="mb-4">
            <CpAuthBanner state={bannerState} onRetry={load} />
          </div>
        )}

        {/* Hero */}
        <header className="mb-4 flex items-baseline justify-between gap-4">
          <div>
            <h1 className="text-[22px] font-medium tracking-tight text-foreground">
              App Marketplace
            </h1>
            <p className="text-[13px] text-foreground/55">
              Sovereign apps that run on — or alongside — your pod.
            </p>
          </div>
          <Chip
            size="sm"
            variant="flat"
            color="default"
            startContent={
              <Package className="ml-1 h-3 w-3" strokeWidth={2.2} />
            }
          >
            {totalCount}
          </Chip>
        </header>

        {/* Filters */}
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center">
          <Tabs
            aria-label="Filter by category"
            variant="underlined"
            size="sm"
            selectedKey={category}
            onSelectionChange={(k) => setCategory(String(k))}
            className="-mb-px"
          >
            {CATEGORIES.map((c) => (
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
              startContent={
                <Search className="h-3.5 w-3.5 text-foreground/45" />
              }
              spellCheck="false"
            />
          </div>
        </div>

        {isLoading ? (
          <div className="flex flex-1 items-center justify-center py-16">
            <Spinner size="md" />
          </div>
        ) : totalCount === 0 ? (
          <p className="py-12 text-center text-[13px] text-foreground/55">
            {apps.length === 0
              ? "No apps reachable. Check your CP connection."
              : "No apps match this filter."}
          </p>
        ) : (
          <div className="flex flex-col gap-7">
            {eveApps.length > 0 && (
              <Section
                title="On your Eve"
                hint="Components that run on your machine."
                count={eveApps.length}
              >
                <CardGrid>
                  {eveApps.map((app) => (
                    <MarketplaceCard
                      key={app.id}
                      app={app}
                      localRef={resolveLocalRef(app, localById)}
                      onInstalled={load}
                    />
                  ))}
                </CardGrid>
              </Section>
            )}

            {synapApps.length > 0 && (
              <Section
                title="Synap apps"
                hint="Hosted on Synap — open in a new tab."
                count={synapApps.length}
              >
                <CardGrid>
                  {synapApps.map((app) => (
                    <MarketplaceCard
                      key={app.id}
                      app={app}
                      localRef={null}
                      onInstalled={load}
                    />
                  ))}
                </CardGrid>
              </Section>
            )}
          </div>
        )}
      </div>
    </>
  );
}

// ─── Section + Grid ──────────────────────────────────────────────────────────

function Section({
  title,
  hint,
  count,
  children,
}: {
  title: string;
  hint: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section>
      <header className="mb-3 flex items-baseline gap-2">
        <h2 className="text-[14px] font-medium text-foreground">{title}</h2>
        <span className="text-[11px] text-foreground/45 tabular-nums">
          {count}
        </span>
        <span className="ml-2 text-[11.5px] text-foreground/55">{hint}</span>
      </header>
      {children}
    </section>
  );
}

function CardGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {children}
    </div>
  );
}

// ─── Card ────────────────────────────────────────────────────────────────────

function resolveLocalRef(
  app: MarketplaceAppWithEntitlement,
  localById: Record<string, LocalComponentRef>,
): LocalComponentRef | null {
  if (app.appType !== "eve_component") return null;
  // The CP catalog can carry an explicit `metadata.componentId` (used
  // when the slug doesn't match the local ID). Fall back to the slug.
  const componentId =
    (app.metadata?.componentId as string | undefined) ?? app.slug;
  return localById[componentId] ?? null;
}

function MarketplaceCard({
  app,
  localRef,
  onInstalled,
}: {
  app: MarketplaceAppWithEntitlement;
  localRef: LocalComponentRef | null;
  onInstalled: () => void;
}) {
  const palette = brandColorFor(app.slug);
  const isLocked = !app.entitled;

  return (
    <Card
      isBlurred
      shadow="none"
      radius="md"
      data-app-slug={app.slug}
      className={
        "relative flex flex-col gap-3 p-4 " +
        "bg-foreground/[0.04] " +
        "ring-1 ring-inset ring-foreground/10 " +
        "transition-colors hover:bg-foreground/[0.07]"
      }
    >
      {/* Lock badge — pinned to the top-right when the user isn't
          entitled. Replaces the prior inline pricing pill so the lock
          state is visually prominent without crowding the action row. */}
      {isLocked && (
        <span
          className="
            absolute right-2.5 top-2.5 z-[1]
            inline-flex items-center gap-1
            rounded-full px-2 py-0.5
            bg-warning/15 border border-warning/30
            text-[10.5px] font-medium uppercase tracking-[0.04em]
            text-warning
          "
          aria-label="Locked — upgrade required"
        >
          <Lock className="h-2.5 w-2.5" strokeWidth={2.4} />
          {pricingChip(app.pricing)}
        </span>
      )}

      <div className={"flex items-start gap-3 " + (isLocked ? "opacity-75" : "")}>
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

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[11px] text-foreground/55 min-w-0 truncate">
          <span className="truncate">{app.category}</span>
          {!isLocked && (
            <>
              <span className="text-foreground/30">·</span>
              <span>{pricingChip(app.pricing)}</span>
            </>
          )}
          {app.installCount > 0 && (
            <>
              <span className="text-foreground/30">·</span>
              <span>{app.installCount} installs</span>
            </>
          )}
        </div>

        <CardActionRow
          app={app}
          localRef={localRef}
          isLocked={isLocked}
          onInstalled={onInstalled}
        />
      </div>
    </Card>
  );
}
