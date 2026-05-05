"use client";

/**
 * `DockIcon` — single icon in the dock pill.
 *
 * Renders a 40×40 visionOS glass tile with a 20×20 Lucide glyph (or
 * remote SVG) over the brand-color gradient. Active state shows a 3px
 * tall accent pill 6px below the icon.
 *
 * The bounding box, the glyph size, and the centering math is shared
 * with `add-app-button.tsx` so every dock entry — pinned, core, or the
 * `+` terminator — feels identical.
 *
 * No drop shadow. Depth comes from the dock's frosted pill behind.
 *
 * See: synap-team-docs/content/team/platform/eve-os-shell.mdx §5
 */

import Link from "next/link";
import {
  Home, Sparkles, Settings as SettingsIcon, MessageSquare, Brain,
  Paperclip, Wrench, Code2, Users, LayoutGrid, Box,
  Cpu, Rss,
  type LucideIcon, type LucideProps,
} from "lucide-react";
import { brandColorFor } from "../lib/brand-colors";
import type { DockApp } from "./use-dock-apps";

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
};

function GlyphFor({
  glyph,
  ...props
}: { glyph: string | null } & LucideProps) {
  if (!glyph) return <Box {...props} />;
  const Icon = GLYPHS[glyph] ?? Box;
  return <Icon {...props} />;
}

export interface DockIconProps {
  app: DockApp;
  active: boolean;
  iconUrl?: string;
}

export function DockIcon({ app, active, iconUrl }: DockIconProps) {
  const palette = brandColorFor(app.slug);
  const useRemote = !palette.glyph && iconUrl;

  return (
    <div className="relative flex h-10 w-10 shrink-0 items-center justify-center">
      <Link
        href={app.path}
        aria-label={`Open ${app.name}`}
        title={app.name}
        className="
          glass-icon
          flex h-10 w-10 items-center justify-center
          transition-transform duration-200 ease-out
          hover:scale-[1.10] active:scale-[0.95] active:duration-[80ms]
          focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50
        "
        style={{ background: palette.bg }}
      >
        {useRemote ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={iconUrl}
            alt=""
            width={20}
            height={20}
            className="h-5 w-5 object-contain"
            referrerPolicy="no-referrer"
          />
        ) : (
          <GlyphFor
            glyph={palette.glyph}
            className="h-5 w-5 text-white"
            strokeWidth={2}
            aria-hidden
          />
        )}
      </Link>

      {/* Active indicator pill — 3px tall x 10px wide, ~6px below the icon. */}
      {active && (
        <span
          className="absolute -bottom-1.5 left-1/2 h-[3px] w-2.5 -translate-x-1/2 rounded-full"
          style={{ background: palette.accent }}
          aria-hidden
        />
      )}
    </div>
  );
}
