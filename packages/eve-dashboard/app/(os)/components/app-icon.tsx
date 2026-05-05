"use client";

/**
 * `AppIcon` — visionOS-style glass app tile.
 *
 * Layered material (`.glass-icon` recipe in globals.css):
 *   1. Brand-color 2-stop gradient as the body
 *   2. 1px white-18% inner ring — implies glass thickness
 *   3. Top-edge linear specular highlight (system-style)
 *
 * No drop shadow — depth comes from the wallpaper bleeding through
 * the pane behind, the way visionOS surfaces work. Hover scales 1.04
 * and brightens the inner ring; press scales 0.96.
 *
 * Text uses HeroUI vibrancy tiers via `text-foreground` + opacity:
 *   • name:   text-foreground (100%)
 *   • status: text-foreground/55 (secondary)
 *
 * Labels are always single-line truncated within `max-w-[112px]` so the
 * grid never reflows.
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
        group flex w-full max-w-[104px] flex-col items-center gap-2
        focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40
        focus-visible:rounded-app-icon
      "
    >
      <span
        className="
          glass-icon
          flex h-[68px] w-[68px] items-center justify-center
          transition-transform duration-200 ease-out
          group-hover:scale-[1.04]
          group-active:scale-[0.96] group-active:duration-[80ms]
          sm:h-[72px] sm:w-[72px]
        "
        style={{ background: palette.bg }}
      >
        {useRemote ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={app.iconUrl}
            alt=""
            width={32}
            height={32}
            className="h-8 w-8 object-contain"
            referrerPolicy="no-referrer"
          />
        ) : (
          <GlyphFor
            glyph={palette.glyph}
            className="h-7 w-7 text-white sm:h-[30px] sm:w-[30px]"
            strokeWidth={2}
            aria-hidden
          />
        )}
        {!app.isEntitled && (
          <span
            className="
              absolute -right-1 -top-1 z-10 rounded-full
              bg-content1 px-1.5 py-0.5 text-[9px] font-medium uppercase
              tracking-wider text-foreground/55 border border-divider
            "
            title="Locked"
          >
            Locked
          </span>
        )}
      </span>

      <span className="flex w-full flex-col items-center leading-none">
        <span
          className="
            block w-full truncate text-center text-[12px] font-medium
            text-foreground
          "
          title={app.name}
        >
          {app.name}
        </span>
        {statusLabel && (
          <span className="mt-1 block w-full truncate text-center text-[10.5px] text-foreground/55">
            {statusLabel}
          </span>
        )}
      </span>
    </a>
  );
}
