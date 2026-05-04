"use client";

/**
 * `AppGrid` — responsive square-tile grid for the OS Home.
 *
 * Columns scale with viewport per design §3.3:
 *   mobile  (<640px)  → 3 cols
 *   tablet  (≥640px)  → 4 cols
 *   desktop (≥1024px) → 6 cols
 *   wide    (≥1440px) → 8 cols
 *
 * The `<AddAppTile />` is always last. dnd-kit reordering ships in
 * Phase 2B; for now the order comes from `useHomeApps` (OpenWebUI
 * pinned, then AI apps, then alphabetical).
 */

import { AddAppTile } from "./add-app-tile";
import { AppTile } from "./app-tile";
import { SkeletonTile } from "./skeleton-tile";
import type { HomeApp } from "../hooks/use-home-apps";

export interface AppGridProps {
  apps: HomeApp[];
  isLoading: boolean;
  /** Hide the trailing AddAppTile — useful when the EmptyState
   *  has its own primary CTA so the page doesn't double up. */
  hideAdd?: boolean;
}

const GRID_CLASSES = [
  "grid w-full",
  "grid-cols-3 gap-3",
  "sm:grid-cols-4 sm:gap-4",
  "lg:grid-cols-6 lg:gap-5",
  "2xl:grid-cols-8 2xl:gap-6",
].join(" ");

export function AppGrid({ apps, isLoading, hideAdd }: AppGridProps) {
  // Render skeletons while we have NOTHING to show. Once any real apps
  // resolve, fall back to the live grid (skeleton-as-suspense flicker
  // looks worse than a partially populated grid).
  if (isLoading && apps.length === 0) {
    return (
      <div id="os-home-grid" className={GRID_CLASSES}>
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonTile key={i} />
        ))}
      </div>
    );
  }

  return (
    <div id="os-home-grid" className={GRID_CLASSES} role="list">
      {apps.map(a => (
        <div key={`${a.source}:${a.id}`} role="listitem">
          <AppTile app={a} />
        </div>
      ))}
      {!hideAdd && (
        <div role="listitem">
          <AddAppTile />
        </div>
      )}
    </div>
  );
}
