"use client";

/**
 * `AppIcon` — premium 2.5D launcher tile.
 *
 * Composed of three layers (see `.app-icon-25d` recipe in globals.css):
 *   1. brand-color vertical gradient (top→mid→dark) as the body
 *   2. ::before specular highlight on the upper 45%
 *   3. inner 1px hairlines + outer drop shadow
 *
 * The glyph (or remote `iconUrl`) sits centered, white at 95% alpha.
 * The label below is always single-line truncated; an optional status
 * line beneath truncates the same way. Layout never reflows.
 *
 * Hover scales 1.04 + brightens the highlight (handled by the .app-icon-25d
 * pseudo). No translateY lift — we want icons to feel pressed into the
 * surface, not floating above it.
 *
 * See: synap-team-docs/content/team/platform/eve-os-home-design.mdx §5
 */

import {
  Box, MessageSquare, Brain, Sparkles, Code2, Wrench, Users,
  LayoutGrid, Paperclip, Home, Settings as SettingsIcon, Cpu, Rss,
  type LucideIcon, type LucideProps,
} from "lucide-react";
import { brandColorFor } from "../lib/brand-colors";
import type { HomeApp } from "../hooks/use-home-apps";

const GLYPHS: Record<string, LucideIcon> = {
  Box, MessageSquare, Brain, Sparkles, Code2, Wrench, Users,
  LayoutGrid, Paperclip, Home, Settings: SettingsIcon, Cpu, Rss,
};

function GlyphFor({ glyph, ...props }: { glyph: string | null } & LucideProps) {
  if (!glyph) return <Box {...props} />;
  const Icon = GLYPHS[glyph] ?? Box;
  return <Icon {...props} />;
}

export interface AppIconProps {
  app: HomeApp;
}

export function AppIcon({ app }: AppIconProps) {
  const palette = brandColorFor(app.id);
  const useRemote = !palette.glyph && Boolean(app.iconUrl);

  // Status text under the icon name. Empty string ⇒ second line is omitted
  // entirely (no reserved blank line — the label sits closer to the icon).
  const statusLabel =
    app.status === "online"
      ? "running"
      : app.status === "offline"
        ? "offline"
        : app.status === "degraded"
          ? "degraded"
          : "";

  return (
    <a
      href={app.url}
      target="_blank"
      rel="noreferrer"
      aria-label={
        statusLabel
          ? `Open ${app.name}, status ${statusLabel}`
          : `Open ${app.name}`
      }
      className="
        group flex w-full max-w-[112px] flex-col items-center gap-2.5
        focus:outline-none focus-visible:rounded-app-icon
        focus-visible:ring-2 focus-visible:ring-emerald-400/40
      "
    >
      <span
        className="
          app-icon-25d
          flex h-16 w-16 items-center justify-center
          transition-transform duration-200 ease-out
          group-hover:scale-[1.04]
          group-active:scale-[0.96] group-active:duration-[80ms]
          sm:h-[72px] sm:w-[72px]
          md:h-20 md:w-20
        "
        style={{ background: palette.bg }}
      >
        {useRemote ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={app.iconUrl}
            alt=""
            width={40}
            height={40}
            className="h-9 w-9 object-contain drop-shadow-[0_1px_1px_rgba(0,0,0,0.4)] sm:h-10 sm:w-10"
            referrerPolicy="no-referrer"
          />
        ) : (
          <GlyphFor
            glyph={palette.glyph}
            className="h-8 w-8 text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.35)] sm:h-9 sm:w-9 md:h-10 md:w-10"
            strokeWidth={1.9}
            aria-hidden
          />
        )}
        {!app.isEntitled && (
          <span
            className="
              absolute -right-1.5 -top-1.5 z-10 rounded-full
              bg-content1 px-1.5 py-0.5 text-[9px] font-medium uppercase
              tracking-wider text-default-500 border border-divider
              shadow-sm
            "
            title="Locked"
          >
            Locked
          </span>
        )}
      </span>

      {/* Label block — fixed two-row max so the grid never reflows.
          Single-line truncate on both name and status. */}
      <span className="flex w-full flex-col items-center leading-none">
        <span
          className="
            block w-full truncate text-center text-[12.5px] font-medium
            text-default-700 dark:text-default-100
            group-hover:text-default-900 dark:group-hover:text-default-50
            transition-colors
          "
          title={app.name}
        >
          {app.name}
        </span>
        {statusLabel && (
          <span
            className="
              mt-1 block w-full truncate text-center text-[10.5px] font-normal
              text-default-500 dark:text-default-400
            "
          >
            {statusLabel}
          </span>
        )}
      </span>
    </a>
  );
}
