"use client";

/**
 * `StatCards` — Zone B of the Home pane.
 *
 * Three translucent stat cards in a horizontal row. Auto-height (~110px),
 * 12px gap, 24px horizontal padding. Skeleton variant uses the same
 * dimensions so the grid below never reflows when stats resolve.
 *
 * See: synap-team-docs/content/team/platform/eve-os-home-design.mdx §4
 */

import { useStats } from "../hooks/use-stats";
import { CP_BASE_URL } from "../lib/cp-oauth";
import { StatCard } from "./stat-card";

const ACCENT_AGENTS = "#34D399";
const ACCENT_EVENTS = "#A78BFA";
const ACCENT_UPDATES = "#FBBF24";

export function StatCards() {
  const { stats, isLoading } = useStats();

  return (
    <div className="grid grid-cols-3 gap-3 px-6">
      <StatCard
        label="Agents"
        value={isLoading ? "—" : `${stats.agentsRunning} running`}
        sublabel={stats.agentsSubLabel}
        accent={ACCENT_AGENTS}
        href="/agents"
        isLoading={isLoading}
        ariaLabel={`${stats.agentsRunning} agents running. Open Agents.`}
      />
      <StatCard
        label="Today"
        value={isLoading ? "—" : `${stats.eventsToday} events`}
        sublabel={stats.eventsSubLabel}
        accent={ACCENT_EVENTS}
        href="/agents?view=timeline"
        isLoading={isLoading}
        ariaLabel={`${stats.eventsToday} events today. Open Agents timeline.`}
      />
      <StatCard
        label="Updates"
        value={
          isLoading
            ? "—"
            : stats.updatesAvailable === 0
              ? "Up to date"
              : `${stats.updatesAvailable} available`
        }
        sublabel={stats.updatesSubLabel}
        accent={ACCENT_UPDATES}
        href={`${CP_BASE_URL}/marketplace`}
        external
        isLoading={isLoading}
        ariaLabel={
          stats.updatesAvailable === 0
            ? "All apps are up to date."
            : `${stats.updatesAvailable} app updates available. Open marketplace.`
        }
      />
    </div>
  );
}
