"use client";

/**
 * `DockPinPopover` — inline pin manager anchored to the dock's `+` button.
 *
 * Lists every installable app (CP marketplace + locally-installed Eve
 * components), de-duplicated by slug. Each row toggles its pinned state
 * through `usePinContext()`. The full marketplace remains reachable via
 * the footer link.
 *
 * Visual notes:
 *   • Frosted glass body, ~320px wide, ≤480px tall (scrolling body).
 *   • Concentric radius: outer 16px → row 14px (outer − 2).
 *   • No shadows. Subtle ring + backdrop-blur per design system.
 */

import Link from "next/link";
import {
  Home, Sparkles, Settings as SettingsIcon, MessageSquare, Brain,
  Paperclip, Wrench, Code2, Users, LayoutGrid, Box, Cpu, Rss, Inbox,
  Activity, Store, LayoutDashboard, Grid3x3, PenTool, Layers,
  Check, Search, X, ArrowRight,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { brandColorFor } from "../lib/brand-colors";
import { createEmbeddedAppHref } from "../lib/app-launch-url";
import {
  fetchMarketplaceApps,
  type MarketplaceAppWithEntitlement,
} from "../lib/marketplace-client";
import { usePinContext, type PinnedApp } from "./pin-context";

interface LocalComponentRow {
  id: string;
  label: string;
  installed: boolean;
  containerRunning: boolean | null;
  hostPort: number | null;
  domainUrl: string | null;
}

interface ComponentsResponse {
  components: LocalComponentRow[];
}

/** Lucide glyph registry — mirrors dock-icon.tsx + extras for marketplace. */
const GLYPHS: Record<string, LucideIcon> = {
  Home,
  Sparkles,
  Settings: SettingsIcon,
  MessageSquare,
  Brain,
  Paperclip,
  Wrench,
  Code2,
  Users,
  LayoutGrid,
  Cpu,
  Rss,
  Inbox,
  Activity,
  Store,
  LayoutDashboard,
  Grid3x3,
  PenTool,
  Layers,
};

/** Unified shape used by the row list — drawn from CP or local sources. */
interface PinCandidate {
  id: string;
  slug: string;
  name: string;
  subtitle: string;
  url: string;
  iconUrl?: string | null;
}

export interface DockPinPopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DockPinPopover({ open, onOpenChange }: DockPinPopoverProps) {
  const { pinnedIds, pin, unpin } = usePinContext();
  const [candidates, setCandidates] = useState<PinCandidate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [query, setQuery] = useState("");

  // Lazy-load once when first opened so the dock doesn't pay for fetches
  // until the operator actually pops it.
  const [hasLoaded, setHasLoaded] = useState(false);
  useEffect(() => {
    if (!open || hasLoaded) return;
    setHasLoaded(true);

    let cancelled = false;
    setIsLoading(true);
    void Promise.allSettled([
      fetchMarketplaceApps({ onUnauthorized: () => { /* silent */ } }),
      fetch("/api/components", { credentials: "include", cache: "no-store" }).then(
        (r) => (r.ok ? (r.json() as Promise<ComponentsResponse>) : null),
      ),
    ]).then(([marketResult, localResult]) => {
      if (cancelled) return;
      const merged = mergeCandidates(
        marketResult.status === "fulfilled" ? marketResult.value.apps : [],
        localResult.status === "fulfilled" ? localResult.value : null,
      );
      setCandidates(merged);
      setIsLoading(false);
    });
    return () => { cancelled = true; };
  }, [open, hasLoaded]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onOpenChange(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter((c) => {
      const hay = `${c.name} ${c.slug} ${c.subtitle}`.toLowerCase();
      return hay.includes(q);
    });
  }, [candidates, query]);

  const handleToggle = useCallback(
    async (c: PinCandidate) => {
      if (pinnedIds.has(c.id)) {
        await unpin(c.id);
      } else {
        const app: PinnedApp = {
          id: c.id,
          slug: c.slug,
          name: c.name,
          url: c.url,
          iconUrl: c.iconUrl ?? null,
        };
        await pin(app);
      }
    },
    [pinnedIds, pin, unpin],
  );

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-label="Pin apps to dock"
      className="
        flex w-[320px] max-h-[480px] flex-col overflow-hidden
        rounded-2xl border border-foreground/10
        bg-background/85 backdrop-blur-2xl
        animate-[dock-pin-pop_180ms_ease-out]
      "
    >
      {/* Header */}
      <header className="flex items-center justify-between px-3.5 pt-3 pb-2.5">
        <h2 className="text-[13.5px] font-medium text-foreground">Pin apps</h2>
        <button
          type="button"
          aria-label="Close"
          onClick={() => onOpenChange(false)}
          className="
            inline-flex h-6 w-6 items-center justify-center
            rounded-full
            text-foreground/55
            transition-colors duration-100
            hover:bg-foreground/[0.07] hover:text-foreground
            focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40
          "
        >
          <X className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
        </button>
      </header>

      {/* Search */}
      <div className="px-3.5 pb-2.5">
        <div
          className="
            flex items-center gap-2 rounded-xl px-2.5 py-1.5
            bg-foreground/[0.05] ring-1 ring-inset ring-foreground/10
          "
        >
          <Search className="h-3.5 w-3.5 shrink-0 text-foreground/45" aria-hidden />
          <input
            type="text"
            placeholder="Search apps…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            spellCheck="false"
            autoFocus
            className="
              flex-1 bg-transparent text-[12.5px] text-foreground
              placeholder:text-foreground/40
              focus:outline-none
            "
          />
        </div>
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {isLoading ? (
          <p className="px-2 py-6 text-center text-[12px] text-foreground/55">
            Loading apps…
          </p>
        ) : filtered.length === 0 ? (
          <p className="px-2 py-6 text-center text-[12px] text-foreground/55">
            {candidates.length === 0 ? "No apps available." : "No matches."}
          </p>
        ) : (
          <ul className="flex flex-col gap-0.5" role="list">
            {filtered.map((c) => (
              <PinRow
                key={c.id}
                candidate={c}
                pinned={pinnedIds.has(c.id)}
                onToggle={() => void handleToggle(c)}
              />
            ))}
          </ul>
        )}
      </div>

      {/* Footer */}
      <footer className="border-t border-foreground/[0.06] px-3.5 py-2">
        <Link
          href="/marketplace"
          onClick={() => onOpenChange(false)}
          className="
            inline-flex items-center gap-1
            text-[12px] text-foreground/65
            transition-colors duration-100
            hover:text-foreground
          "
        >
          Browse marketplace
          <ArrowRight className="h-3 w-3" strokeWidth={2} aria-hidden />
        </Link>
      </footer>
    </div>
  );
}

function PinRow({
  candidate,
  pinned,
  onToggle,
}: {
  candidate: PinCandidate;
  pinned: boolean;
  onToggle: () => void;
}) {
  const palette = brandColorFor(candidate.slug);
  const Glyph = palette.glyph ? (GLYPHS[palette.glyph] ?? Box) : Box;
  const useRemote = !palette.glyph && candidate.iconUrl;

  return (
    <li>
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={pinned}
        onClick={onToggle}
        className="
          flex w-full items-center gap-2.5 px-2 py-1.5
          rounded-[14px]
          text-left
          transition-colors duration-100
          hover:bg-foreground/[0.06]
          focus:outline-none focus-visible:bg-foreground/[0.06]
        "
      >
        <span
          className="
            glass-icon
            flex h-8 w-8 shrink-0 items-center justify-center
          "
          style={{ background: palette.bg }}
          aria-hidden
        >
          {useRemote ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={candidate.iconUrl ?? ""}
              alt=""
              width={16}
              height={16}
              className="h-4 w-4 object-contain"
              referrerPolicy="no-referrer"
            />
          ) : (
            <Glyph className="h-4 w-4 text-white" strokeWidth={2} aria-hidden />
          )}
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-medium leading-tight text-foreground">
            {candidate.name}
          </span>
          {candidate.subtitle && (
            <span className="mt-0.5 block truncate text-[11px] text-foreground/55">
              {candidate.subtitle}
            </span>
          )}
        </span>

        <span
          className={
            "flex h-5 w-5 shrink-0 items-center justify-center rounded-full " +
            (pinned
              ? "bg-primary/15 text-primary"
              : "text-transparent")
          }
          aria-hidden
        >
          {pinned && <Check className="h-3 w-3" strokeWidth={2.4} />}
        </span>
      </button>
    </li>
  );
}

// ─── Merge helpers ───────────────────────────────────────────────────────────

/**
 * Merge marketplace apps + local components into a single de-duplicated
 * candidate list keyed by slug. Marketplace entries win on metadata; local
 * components fill in for anything CP doesn't publish (or while offline).
 */
function mergeCandidates(
  market: MarketplaceAppWithEntitlement[],
  local: ComponentsResponse | null,
): PinCandidate[] {
  const bySlug = new Map<string, PinCandidate>();

  for (const app of market) {
    if (app.status !== "published") continue;
    if (app.appType !== "url" && app.appType !== "eve_component") continue;
    const url = resolveMarketUrl(app, local);
    if (!url) continue;
    bySlug.set(app.slug, {
      id: app.id,
      slug: app.slug,
      name: app.name,
      subtitle: hostFromUrl(url) ?? app.category,
      url,
      iconUrl: app.iconUrl,
    });
  }

  if (local) {
    for (const row of local.components) {
      if (bySlug.has(row.id)) continue;
      const url = localUrl(row);
      if (!url) continue;
      bySlug.set(row.id, {
        id: row.id,
        slug: row.id,
        name: row.label,
        subtitle: "Local component",
        url: createEmbeddedAppHref({ id: row.id, name: row.label, url }),
      });
    }
  }

  return Array.from(bySlug.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}

function resolveMarketUrl(
  app: MarketplaceAppWithEntitlement,
  local: ComponentsResponse | null,
): string | null {
  if (app.appType === "url" && app.appUrl) {
    return createEmbeddedAppHref({ id: app.id, name: app.name, url: app.appUrl });
  }
  if (app.appType === "eve_component" && local) {
    const componentId =
      (app.metadata?.componentId as string | undefined) ?? app.slug;
    const row = local.components.find((r) => r.id === componentId);
    if (!row) return null;
    const url = localUrl(row);
    if (!url) return null;
    return createEmbeddedAppHref({ id: app.id, name: app.name, url });
  }
  return null;
}

function localUrl(row: LocalComponentRow): string | null {
  if (row.domainUrl) return row.domainUrl;
  if (row.hostPort && typeof window !== "undefined") {
    return `http://${window.location.hostname}:${row.hostPort}`;
  }
  return null;
}

function hostFromUrl(url: string): string | null {
  try {
    return new URL(url, "http://_local_").host.replace(/^_local_$/, "");
  } catch {
    return null;
  }
}
