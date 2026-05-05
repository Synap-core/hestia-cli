"use client";

/**
 * `AppGrid` — Zone C of the Home pane.
 *
 * Responsive CSS grid of vivid colorful `AppIcon`s. Auto-fills columns
 * based on pane width (~6–8 on desktop, 3–4 on mobile).
 *
 * Skeleton state matches the count cached from the previous visit
 * (stored under `home.iconCount` in localStorage) so the grid feels
 * instant on returning visits. Genuine first load defaults to 6.
 *
 * The `+ Add` icon is always last, even during skeleton render — gives
 * the operator a clear path to the marketplace before anything resolves.
 *
 * See: synap-team-docs/content/team/platform/eve-os-home-design.mdx §5
 */

import { useEffect, useRef } from "react";
import { AppIcon } from "./app-icon";
import { AddAppIcon } from "./add-app-icon";
import { SkeletonIcon } from "./skeleton-icon";
import type { HomeApp } from "../hooks/use-home-apps";

export interface AppGridProps {
  apps: HomeApp[];
  isLoading: boolean;
  /** Hide the "+ Add" terminator (used by the empty-state CTA). */
  hideAdd?: boolean;
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
  grid grid-cols-3 gap-6
  sm:grid-cols-4 sm:gap-7
  md:grid-cols-6
  lg:grid-cols-7
  xl:grid-cols-8
  px-6 pb-8 pt-2
  content-start
`;

export function AppGrid({ apps, isLoading, hideAdd }: AppGridProps) {
  const cachedCountRef = useRef<number | null>(null);

  // Cache the resolved count so the next mount renders the right
  // skeleton density. Updated whenever `apps` changes meaningfully.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (apps.length === 0) return;
    window.localStorage.setItem(STORAGE_KEY, String(apps.length));
  }, [apps.length]);

  if (cachedCountRef.current === null) {
    cachedCountRef.current = readCachedIconCount();
  }

  if (isLoading && apps.length === 0) {
    return (
      <div id="home-app-grid" className={GRID}>
        {Array.from({ length: cachedCountRef.current }).map((_, i) => (
          <SkeletonIcon key={i} />
        ))}
        {!hideAdd && <AddAppIcon />}
      </div>
    );
  }

  return (
    <div id="home-app-grid" className={GRID} role="list">
      {apps.map(app => (
        <div key={`${app.source}:${app.id}`} role="listitem" className="animate-icon-fade-in">
          <AppIcon app={app} />
        </div>
      ))}
      {!hideAdd && (
        <div role="listitem">
          <AddAppIcon />
        </div>
      )}
    </div>
  );
}
