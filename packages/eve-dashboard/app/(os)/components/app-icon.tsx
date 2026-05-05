"use client";

/**
 * `AppIcon` — vivid colored icon in the Home grid.
 *
 * 80×80 (desktop) / 64×64 (mobile) rounded square painted with the
 * brand color from `lib/brand-colors.ts`. Glyph centered in the upper
 * 70%, label below.
 *
 * Hover: scale 1.04 + outer glow ring (NO translateY). Press: 0.96.
 * Active state mirrors default — the dock owns the active indicator,
 * the grid does NOT double-mark.
 *
 * See: synap-team-docs/content/team/platform/eve-os-home-design.mdx §5
 */

import {
  Box, MessageSquare, Brain, Sparkles, Code2, Wrench, Users,
  LayoutGrid, Paperclip, Home, Settings as SettingsIcon,
  type LucideIcon, type LucideProps,
} from "lucide-react";
import { brandColorFor } from "../lib/brand-colors";
import type { HomeApp } from "../hooks/use-home-apps";

const GLYPHS: Record<string, LucideIcon> = {
  Box, MessageSquare, Brain, Sparkles, Code2, Wrench, Users,
  LayoutGrid, Paperclip, Home, Settings: SettingsIcon,
};

function GlyphFor({ name, ...props }: { name: string | null } & LucideProps) {
  if (!name) return <Box {...props} />;
  const Icon = GLYPHS[name] ?? Box;
  return <Icon {...props} />;
}

export interface AppIconProps {
  app: HomeApp;
}

export function AppIcon({ app }: AppIconProps) {
  // Status text under the icon. Empty string ⇒ second line is dropped.
  const statusLabel =
    app.status === "online"
      ? "running"
      : app.status === "offline"
        ? "offline"
        : app.status === "degraded"
          ? "degraded"
          : "";

  const palette = brandColorFor(app.id);
  const useRemote = !palette.glyph && Boolean(app.iconUrl);

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
        group flex flex-col items-center gap-3
        focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40
        focus-visible:rounded-2xl
      "
    >
      <span
        className="
          relative flex h-16 w-16 items-center justify-center
          rounded-[18px]
          transition-transform duration-200 ease-out
          group-hover:scale-[1.04]
          group-active:scale-[0.96] group-active:duration-[80ms]
          sm:h-20 sm:w-20
        "
        style={{ background: palette.bg }}
      >
        {/* Outer glow ring on hover. Brand-color, 35% opacity, 24px blur. */}
        <span
          className="
            pointer-events-none absolute inset-0 rounded-[18px]
            opacity-0 group-hover:opacity-100
            transition-opacity duration-200 ease-out
          "
          aria-hidden
          style={{ boxShadow: `0 0 24px -4px ${palette.accent}59` }}
        />
        {useRemote ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={app.iconUrl}
            alt=""
            width={40}
            height={40}
            className="h-8 w-8 object-contain sm:h-10 sm:w-10"
            referrerPolicy="no-referrer"
          />
        ) : (
          <GlyphFor
            name={palette.glyph}
            className="h-8 w-8 text-white/95 sm:h-10 sm:w-10"
            strokeWidth={1.6}
            aria-hidden
          />
        )}
        {!app.isEntitled && (
          <span
            className="
              absolute -right-1 -top-1 rounded-full bg-content1
              px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider
              text-default-500 border border-divider
            "
            title="Locked"
          >
            Locked
          </span>
        )}
      </span>
      <span className="flex flex-col items-center gap-0.5 max-w-[112px]">
        <span
          className="
            truncate text-[13px] font-medium leading-tight
            text-default-700 dark:text-default-200
            group-hover:text-default-900 dark:group-hover:text-default-50
            transition-colors
          "
          title={app.name}
        >
          {app.name}
        </span>
        {statusLabel && (
          <span className="text-[11px] text-default-500 leading-tight">{statusLabel}</span>
        )}
      </span>
    </a>
  );
}
