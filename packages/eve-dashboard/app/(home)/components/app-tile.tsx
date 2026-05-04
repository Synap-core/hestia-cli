"use client";

/**
 * `AppTile` — one launchable app on the OS Home grid.
 *
 * Square 128px (desktop) tile. Icon → name. Status dot bottom-right.
 * AI variant gets the emerald `.ai-tint` wash defined in globals.css.
 *
 * Click opens the app's URL in a new tab — these are external surfaces
 * (the dashboard never *embeds* another app's UI). Anchor element so
 * keyboard / screen-reader navigation Just Works.
 *
 * See: synap-team-docs/content/team/platform/eve-os-home-design.mdx §3.4
 */

import Image from "next/image";
import {
  type LucideIcon, Box, MessageSquare, Brain, FileText, BookOpen, Globe,
  Bot, Wrench, Boxes, Activity, Users, BarChart3,
} from "lucide-react";
import type { HomeApp, AppStatus } from "../hooks/use-home-apps";

export interface AppTileProps {
  app: HomeApp;
}

// ─── Status dot ──────────────────────────────────────────────────────────────

const STATUS_COLOR: Record<AppStatus, string> = {
  // Tailwind utilities map to the design spec hex values; keeping them
  // string literals lets the JIT pick them up.
  online:   "bg-status-online",
  degraded: "bg-status-degraded",
  offline:  "bg-status-offline",
  // `unknown` renders no dot at all — purely visual silence.
  unknown:  "",
};

const STATUS_LABEL: Record<AppStatus, string> = {
  online:   "online",
  degraded: "degraded",
  offline:  "offline",
  unknown:  "status unknown",
};

// ─── Lucide fallback icons ───────────────────────────────────────────────────

const LUCIDE_BY_LABEL: Record<string, LucideIcon> = {
  chat:     MessageSquare,
  brain:    Brain,
  bot:      Bot,
  doc:      FileText,
  book:     BookOpen,
  globe:    Globe,
  wrench:   Wrench,
  box:      Box,
  boxes:    Boxes,
  activity: Activity,
  users:    Users,
  chart:    BarChart3,
};

function lucideFor(name: string | undefined): LucideIcon {
  if (!name) return Box;
  return LUCIDE_BY_LABEL[name.toLowerCase()] ?? Box;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function AppTile({ app }: AppTileProps) {
  const Icon = lucideFor(app.iconLucide);
  const dotClass = STATUS_COLOR[app.status];

  // Compose the visual state classes. Default frame is a low-contrast
  // surface with a whisper-thin border, lifting on hover via translateY.
  // AI tiles swap the background for the emerald gradient defined in
  // globals.css.
  const frame = [
    "group relative aspect-square w-full",
    "flex flex-col items-center justify-between",
    "px-3 pt-6 pb-3.5",
    "rounded-tile border",
    "transition-[transform,background-color,border-color] duration-200 ease-out",
    "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    "hover:-translate-y-0.5 active:translate-y-0 active:opacity-95",
    app.isAI
      ? "ai-tint"
      : "border-divider bg-content1 hover:bg-content2/70",
  ].join(" ");

  return (
    <a
      href={app.url}
      target="_blank"
      rel="noreferrer"
      aria-label={`Open ${app.name}, ${STATUS_LABEL[app.status]}`}
      className={frame}
    >
      {/* Icon — remote URL when available, falls back to emoji or
          a Lucide silhouette. Centered top with breathing room above. */}
      <span className="flex flex-1 items-center justify-center">
        {app.iconUrl ? (
          // Plain <img> on purpose — these are arbitrary external CDNs
          // that we don't want to whitelist in next.config one-by-one.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={app.iconUrl}
            alt=""
            width={48}
            height={48}
            className="h-12 w-12 object-contain"
            referrerPolicy="no-referrer"
          />
        ) : app.emoji ? (
          <span aria-hidden className="text-3xl leading-none">
            {app.emoji}
          </span>
        ) : (
          <Icon
            className={
              "h-8 w-8 " +
              (app.isAI ? "text-primary" : "text-default-500 group-hover:text-foreground")
            }
            aria-hidden
          />
        )}
      </span>

      {/* Name + (optional) status dot. Status sits to the left of the
          name as a 6px circle so the layout never reflows when status
          flips between online/offline. */}
      <span className="flex w-full items-center justify-center gap-1.5">
        {dotClass && (
          <span
            className={`h-1.5 w-1.5 rounded-full shrink-0 ${dotClass}`}
            aria-hidden
          />
        )}
        <span
          className={
            "truncate text-[13px] font-medium " +
            (app.isEntitled ? "text-foreground" : "text-default-400")
          }
          title={app.name}
        >
          {app.name}
        </span>
      </span>

      {/* Locked state badge — Phase 2A keeps it tiny; richer "Upgrade"
          flow lands later. */}
      {!app.isEntitled && (
        <span
          className="
            absolute right-2 top-2 rounded-md border border-divider
            bg-content1/80 px-1.5 py-0.5 text-[10px] font-medium uppercase
            tracking-wide text-default-500
          "
        >
          Locked
        </span>
      )}
    </a>
  );
}

// Suppress unused-import lint — Image is intentionally not used yet
// (we reach for next/image once the icon CDN list stabilises).
void Image;
