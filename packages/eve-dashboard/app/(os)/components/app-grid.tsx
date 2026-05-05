"use client";

/**
 * `AppGrid` — Zone C of the Home pane.
 *
 * Three labelled sections, top → bottom:
 *
 *   1. **Core**         — pinned first-party Eve apps (Inbox, Pulse,
 *                         Agents, Marketplace). Internal routes; the
 *                         only place a count chip can show up.
 *   2. **On your Eve**  — `app.isLocal === true`. Components running
 *                         on this machine (Chat, OpenClaw, Hermes…)
 *                         and marketplace `eve_component` entries.
 *   3. **Synap apps**   — `app.isLocal === false`. First-party apps
 *                         hosted on `.synap.live` (Studio, Hub, Canvas,
 *                         CRM, DevPlane, The Arch).
 *
 * The "+ Add" tile lives at the end of the Synap-apps row — opening the
 * marketplace is the natural follow-up to either external section.
 *
 * Skeleton state matches the count cached from the previous visit
 * (stored under `home.iconCount` in localStorage) so the grid feels
 * instant on returning visits. Genuine first load defaults to 6.
 *
 * See: synap-team-docs/content/team/platform/eve-os-home-design.mdx §5
 */

import { useEffect, useMemo, useRef } from "react";
import { AppIcon } from "./app-icon";
import { AddAppIcon } from "./add-app-icon";
import { SkeletonIcon } from "./skeleton-icon";
import { CoreTile, type CoreTileSpec } from "./core-tile";
import type { HomeApp } from "../hooks/use-home-apps";

export interface AppGridProps {
  apps: HomeApp[];
  isLoading: boolean;
  /** Where the trailing "+ Add" tile points. */
  marketplaceUrl: string;
  /** Hide the "+ Add" terminator (used by the empty-state CTA). */
  hideAdd?: boolean;
  /**
   * Live counters for the Core section. Drives the unread-pip on the
   * Inbox tile. `undefined` = render zero (chip hidden); never blocks
   * render — Core tiles always show.
   */
  coreCounts?: {
    proposals?: number;
  };
}

const STORAGE_KEY = "home.iconCount";
const DEFAULT_SKELETON_COUNT = 6;

function readCachedIconCount(): number {
  if (typeof window === "undefined") return DEFAULT_SKELETON_COUNT;
  const v = window.localStorage.getItem(STORAGE_KEY);
  const parsed = v ? Number.parseInt(v, 10) : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_SKELETON_COUNT;
  return Math.min(parsed, 24); // sanity cap
}

const GRID = `
  grid grid-cols-3 gap-x-4 gap-y-6
  sm:grid-cols-4 sm:gap-x-5 sm:gap-y-7
  md:grid-cols-6
  lg:grid-cols-7
  xl:grid-cols-8
  px-2
  content-start justify-items-start
`;

export function AppGrid({
  apps,
  isLoading,
  marketplaceUrl,
  hideAdd,
  coreCounts,
}: AppGridProps) {
  const cachedCountRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (apps.length === 0) return;
    window.localStorage.setItem(STORAGE_KEY, String(apps.length));
  }, [apps.length]);

  if (cachedCountRef.current === null) {
    cachedCountRef.current = readCachedIconCount();
  }

  const coreSpecs = useMemo<CoreTileSpec[]>(
    () => [
      {
        id: "inbox",
        href: "/inbox",
        name: "Inbox",
        count: coreCounts?.proposals,
      },
      { id: "pulse", href: "/pulse", name: "Pulse" },
      { id: "agents", href: "/agents", name: "Agents" },
      { id: "marketplace", href: marketplaceUrl, name: "Marketplace" },
    ],
    [coreCounts?.proposals, marketplaceUrl],
  );

  // Skeleton — single block, no section labels (we don't yet know
  // which side of the split each app lives on).
  if (isLoading && apps.length === 0) {
    return (
      <div id="home-app-grid" className="flex flex-col gap-7 pt-2 pb-6">
        <Section title="Core" hint="Pinned to this Eve.">
          <div className={GRID} role="list">
            {coreSpecs.map((s) => (
              <div key={s.id} role="listitem">
                <CoreTile spec={s} />
              </div>
            ))}
          </div>
        </Section>
        <div className={GRID}>
          {Array.from({ length: cachedCountRef.current }).map((_, i) => (
            <SkeletonIcon key={i} />
          ))}
          {!hideAdd && <AddAppIcon href={marketplaceUrl} />}
        </div>
      </div>
    );
  }

  const localApps = apps.filter((a) => a.isLocal);
  const synapApps = apps.filter((a) => !a.isLocal);

  return (
    <div id="home-app-grid" className="flex flex-col gap-7 pt-2 pb-6">
      <Section title="Core" hint="Pinned to this Eve.">
        <div className={GRID} role="list">
          {coreSpecs.map((s) => (
            <div key={s.id} role="listitem">
              <CoreTile spec={s} />
            </div>
          ))}
        </div>
      </Section>

      {localApps.length > 0 && (
        <Section title="On your Eve" hint="Running on this machine.">
          <div className={GRID} role="list">
            {localApps.map((app) => (
              <div
                key={`${app.source}:${app.id}`}
                role="listitem"
                className="animate-icon-fade-in"
              >
                <AppIcon app={app} />
              </div>
            ))}
          </div>
        </Section>
      )}

      {synapApps.length > 0 && (
        <Section title="Synap apps" hint="Hosted on synap.live.">
          <div className={GRID} role="list">
            {synapApps.map((app) => (
              <div
                key={`${app.source}:${app.id}`}
                role="listitem"
                className="animate-icon-fade-in"
              >
                <AppIcon app={app} />
              </div>
            ))}
            {!hideAdd && (
              <div role="listitem">
                <AddAppIcon href={marketplaceUrl} />
              </div>
            )}
          </div>
        </Section>
      )}

      {/* Edge case: only Synap apps were hidden (no marketplace, no url
          apps reachable) — keep the "+ Add" tile reachable from the
          local row so the user can browse the marketplace. */}
      {synapApps.length === 0 && localApps.length > 0 && !hideAdd && (
        <div className={`${GRID}`} role="list">
          <div role="listitem">
            <AddAppIcon href={marketplaceUrl} />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Section header ──────────────────────────────────────────────────────────

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <header className="mb-3 flex items-baseline gap-2 px-2">
        <h2 className="text-[12.5px] font-medium uppercase tracking-[0.06em] text-foreground/70">
          {title}
        </h2>
        <span className="text-[11.5px] text-foreground/45">·</span>
        <span className="text-[11.5px] text-foreground/55">{hint}</span>
      </header>
      {children}
    </section>
  );
}
