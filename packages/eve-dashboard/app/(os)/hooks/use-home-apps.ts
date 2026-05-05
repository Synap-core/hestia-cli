"use client";

/**
 * `useHomeApps` — single source of truth for the OS Home grid.
 *
 * Fetches in parallel:
 *   • CP marketplace apps (entitled-only)  — auth via `cp.userToken`
 *   • Local Eve components                  — `/api/components`
 *
 * Merges the two streams into a flat `App[]` ready for `<AppGrid />`:
 *
 *   • For an `eve_component` marketplace app, we cross-reference the
 *     local components list to hydrate live status (online / offline).
 *   • OpenWebUI is auto-pinned as "Chat" when it's installed locally,
 *     even if the marketplace catalog hasn't been reached yet — so the
 *     user always has *something* to click on a fresh boot.
 *   • Marketplace 401 ⇒ `bannerState: "signed-out"` (CpAuthBanner reads
 *     this). Marketplace 5xx / network ⇒ `bannerState: "error"`. Either
 *     way the local-components fallback still populates the grid.
 *
 * See: synap-team-docs/content/team/platform/eve-os-home-design.mdx §4
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CpUnauthorizedError,
  MarketplaceError,
  fetchMarketplaceApps,
  type MarketplaceAppWithEntitlement,
} from "../lib/marketplace-client";
import type { CpAuthBannerState } from "../../components/cp-auth-banner";

// ─── Public types ────────────────────────────────────────────────────────────

export type AppSource = "cp_marketplace" | "local_component" | "pinned_default";

export type AppCategory = "ai" | "productivity" | "communication" | "dev" | "other";

export type AppStatus = "online" | "degraded" | "offline" | "unknown";

export interface HomeApp {
  /** Stable ID across sources. Marketplace slug for catalog apps;
   *  component ID for local-only ones. */
  id: string;
  source: AppSource;
  name: string;
  description?: string;
  /** Remote icon URL (preferred). */
  iconUrl?: string;
  /** Lucide icon name fallback (resolved at render time). */
  iconLucide?: string;
  /** Single-character/emoji fallback for components without icons. */
  emoji?: string;
  /** Where clicking opens. New tab. */
  url: string;
  category: AppCategory;
  status: AppStatus;
  /** Triggers emerald-accent tile variant. */
  isAI?: boolean;
  /** False = locked, show "Upgrade" affordance (deferred). */
  isEntitled: boolean;
  installCount?: number;
}

export interface UseHomeAppsResult {
  apps: HomeApp[];
  isLoading: boolean;
  /** Network error from local components or other non-CP issues. */
  error: Error | null;
  /** Convenience flag for callers that want to render "showing local
   *  apps only" hints (matches §4.2 of the design doc). */
  isMarketplaceUnreachable: boolean;
  /** Drives `<CpAuthBanner state={...} />`. */
  bannerState: CpAuthBannerState;
  /** Refire both fetches. */
  refetch: () => void;
}

// ─── Local component shape (mirror of `/api/components` response) ────────────

interface LocalComponentRow {
  id: string;
  label: string;
  emoji: string;
  description: string;
  category: string;
  installed: boolean;
  containerRunning: boolean | null;
  hostPort: number | null;
  subdomain: string | null;
  domainUrl: string | null;
}

interface ComponentsResponse {
  components: LocalComponentRow[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Map a CP marketplace category string onto our coarser Home buckets. */
function mapCategory(raw: string | null | undefined): AppCategory {
  const c = (raw ?? "").toLowerCase();
  if (c.includes("ai") || c.includes("intelligence")) return "ai";
  if (c.includes("chat") || c.includes("comms") || c.includes("communication")) return "communication";
  if (c.includes("dev") || c.includes("code") || c.includes("infra")) return "dev";
  if (c.includes("productivity") || c.includes("note") || c.includes("task")) return "productivity";
  return "other";
}

/** Extract a launchable URL from a local component, mirroring the
 *  selection rule LaunchCard uses on `/dashboard`: domain wins, host
 *  port falls back. Returns null when there's no UI to launch. */
function localComponentWebUrl(c: LocalComponentRow): string | null {
  if (c.domainUrl) return c.domainUrl;
  if (c.hostPort) {
    // Best effort — at SSR we can't read `window.location.hostname` so
    // we leave the href to be filled in client-side. In practice this
    // hook only runs in the browser (see "use client" above) so this
    // is fine.
    if (typeof window !== "undefined") {
      return `http://${window.location.hostname}:${c.hostPort}`;
    }
    return `http://localhost:${c.hostPort}`;
  }
  return null;
}

/** Component IDs that should always render with the AI accent. */
const AI_LOCAL_COMPONENTS = new Set(["openwebui", "synap", "openclaw"]);

/** Component IDs we never want to show as a launcher tile (e.g. the
 *  dashboard launches itself — would be weird). */
const HIDDEN_COMPONENTS = new Set(["eve-dashboard", "traefik"]);

function localToHomeApp(c: LocalComponentRow): HomeApp | null {
  if (HIDDEN_COMPONENTS.has(c.id)) return null;
  const url = localComponentWebUrl(c);
  if (!url) return null;

  // OpenWebUI is special-cased to surface as "Chat" on the OS Home — it
  // is the most-used UI on a daily stack.
  const isOpenWebUi = c.id === "openwebui";
  const name = isOpenWebUi ? "Chat" : c.label;

  let status: AppStatus = "unknown";
  if (c.installed && c.containerRunning) status = "online";
  else if (c.installed && c.containerRunning === false) status = "offline";

  return {
    id: c.id,
    source: "local_component",
    name,
    description: c.description,
    emoji: c.emoji,
    url,
    category: AI_LOCAL_COMPONENTS.has(c.id) ? "ai" : mapCategory(c.category),
    status,
    isAI: AI_LOCAL_COMPONENTS.has(c.id),
    isEntitled: true,
    installCount: undefined,
  };
}

function marketplaceToHomeApp(
  m: MarketplaceAppWithEntitlement,
  localById: Map<string, LocalComponentRow>,
): HomeApp | null {
  // workspace_pack apps install into Synap as a workspace, not as an
  // OS-launchable surface. Skip them on the Home (per design §4.2).
  if (m.appType === "workspace_pack") return null;

  // Bundles aren't fully resolved in Phase 2A — render the bundle's
  // own URL if present, otherwise drop it.
  if (m.appType === "bundle" && !m.appUrl) return null;

  let url = m.appUrl ?? "";
  let status: AppStatus = "unknown";

  if (m.appType === "eve_component") {
    // Cross-reference the local registry for live status + URL.
    const componentId =
      (m.metadata?.componentId as string | undefined) ?? m.slug;
    const local = localById.get(componentId);
    if (local) {
      const localUrl = localComponentWebUrl(local);
      if (localUrl) url = localUrl;
      if (local.installed && local.containerRunning) status = "online";
      else if (local.installed && local.containerRunning === false) status = "offline";
    } else if (!url) {
      // Catalog says it's an Eve component but it isn't installed locally
      // and the catalog has no URL — drop, nothing to launch.
      return null;
    }
  }

  if (!url) return null;

  const cat = mapCategory(m.category);
  const isAI = cat === "ai" || cat === "communication" && m.slug.includes("chat");

  return {
    id: m.slug,
    source: "cp_marketplace",
    name: m.name,
    description: m.description ?? undefined,
    iconUrl: m.iconUrl ?? undefined,
    url,
    category: cat,
    status,
    isAI,
    isEntitled: m.entitled,
    installCount: m.installCount,
  };
}

/** Stable de-dupe: when an app appears in both sources (e.g. a
 *  marketplace `eve_component` for OpenWebUI AND the local registry
 *  entry), prefer the marketplace record because it carries the
 *  catalog metadata (description, icon, install count). */
function dedupe(apps: HomeApp[]): HomeApp[] {
  const seen = new Map<string, HomeApp>();
  // Two passes — marketplace wins.
  for (const a of apps) if (a.source === "cp_marketplace") seen.set(a.id, a);
  for (const a of apps) {
    if (seen.has(a.id)) continue;
    seen.set(a.id, a);
  }
  return Array.from(seen.values());
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useHomeApps(): UseHomeAppsResult {
  const [apps, setApps] = useState<HomeApp[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [bannerState, setBannerState] = useState<CpAuthBannerState>({ kind: "working" });
  const [isMarketplaceUnreachable, setIsMarketplaceUnreachable] = useState(false);
  const tickRef = useRef(0);

  const load = useCallback(async () => {
    const tick = ++tickRef.current;
    setIsLoading(true);
    setError(null);

    // Local components first — fast, lives on the same origin.
    let localRows: LocalComponentRow[] = [];
    try {
      const res = await fetch("/api/components", {
        credentials: "include",
        cache: "no-store",
      });
      if (res.ok) {
        const json = (await res.json()) as ComponentsResponse;
        localRows = json.components ?? [];
      } else if (res.status === 401) {
        // Local dashboard auth missing — middleware will already have
        // redirected to /login by now. Treat this run as bailing out.
        if (tickRef.current !== tick) return;
        setIsLoading(false);
        return;
      } else {
        setError(new Error(`/api/components returned ${res.status}`));
      }
    } catch (e) {
      setError(e instanceof Error ? e : new Error("Failed to load components"));
    }

    // Marketplace second — slower, may bounce through OAuth. The
    // marketplace client handles 401 by triggering OAuth, but we
    // override that here so the page can render with a banner instead
    // of a forced redirect.
    let marketRows: MarketplaceAppWithEntitlement[] = [];
    let nextBanner: CpAuthBannerState = { kind: "working" };
    let unreachable = false;
    try {
      const res = await fetchMarketplaceApps({
        // Don't redirect — let the page render with the banner.
        onUnauthorized: () => { /* swallowed; banner handles it */ },
      });
      marketRows = res.apps;
    } catch (e) {
      if (e instanceof CpUnauthorizedError) {
        nextBanner = { kind: "signed-out" };
      } else if (e instanceof MarketplaceError) {
        nextBanner = { kind: "error", message: `HTTP ${e.status}` };
        unreachable = true;
      } else {
        nextBanner = {
          kind: "error",
          message: e instanceof Error ? e.message : "Network error",
        };
        unreachable = true;
      }
    }

    if (tickRef.current !== tick) return; // stale request — abandon

    // Build the merged list.
    const localById = new Map(localRows.map(r => [r.id, r] as const));
    const merged: HomeApp[] = [];
    for (const m of marketRows) {
      const a = marketplaceToHomeApp(m, localById);
      if (a) merged.push(a);
    }
    for (const r of localRows) {
      const a = localToHomeApp(r);
      if (a) merged.push(a);
    }

    // OpenWebUI gets pinned to the front when present.
    const final = dedupe(merged).sort((a, b) => {
      if (a.id === "openwebui") return -1;
      if (b.id === "openwebui") return 1;
      // AI apps next, then alphabetical.
      if (a.isAI && !b.isAI) return -1;
      if (!a.isAI && b.isAI) return 1;
      return a.name.localeCompare(b.name);
    });

    setApps(final);
    setBannerState(nextBanner);
    setIsMarketplaceUnreachable(unreachable);
    setIsLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const refetch = useCallback(() => { void load(); }, [load]);

  return useMemo(
    () => ({ apps, isLoading, error, isMarketplaceUnreachable, bannerState, refetch }),
    [apps, isLoading, error, isMarketplaceUnreachable, bannerState, refetch],
  );
}
