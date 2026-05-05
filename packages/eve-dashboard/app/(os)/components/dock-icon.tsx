"use client";

/**
 * `DockIcon` — single icon in the dock pill.
 *
 * Renders a vivid 48×48 rounded square with a Lucide glyph (or remote
 * SVG) over the brand-color background from `lib/brand-colors.ts`.
 *
 * States (per shell §5):
 *   • Default — vivid icon, no extras
 *   • Hover   — scale 1.08 (200ms ease-out) + outer glow ring (8px,
 *               accent at 20% opacity)
 *   • Active  — 4px-tall x 12px-wide pill underneath, color-matched
 *   • Press   — scale 0.95 (80ms)
 *
 * No emoji is used anywhere in the dock — Lucide for known apps,
 * remote SVG/PNG for marketplace apps.
 */

import Link from "next/link";
import dynamic from "next/dynamic";
import type { LucideIcon, LucideProps } from "lucide-react";
import {
  Home, Sparkles, Settings as SettingsIcon, MessageSquare, Brain,
  Paperclip, Wrench, Code2, Users, LayoutGrid, Box,
} from "lucide-react";
import { brandColorFor } from "../lib/brand-colors";
import type { DockApp } from "./use-dock-apps";

// Statically import the small set of glyphs the dock + grid use today.
// Adding to the registry: add the brand-colors entry, then the matching
// Lucide import here. The runtime resolver below maps name→component.
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
};

function GlyphFor({
  name,
  ...props
}: { name: string | null } & LucideProps) {
  if (!name) return <Box {...props} />;
  const Icon = GLYPHS[name] ?? Box;
  return <Icon {...props} />;
}

void dynamic; // reserved for future remote-icon component

export interface DockIconProps {
  app: DockApp;
  active: boolean;
  /** Optional iconUrl (marketplace apps) — overrides the Lucide glyph. */
  iconUrl?: string;
}

export function DockIcon({ app, active, iconUrl }: DockIconProps) {
  const palette = brandColorFor(app.slug);
  const useRemote = !palette.glyph && iconUrl;

  return (
    <Link
      href={app.path}
      aria-label={`Open ${app.name}`}
      title={app.name}
      className="
        group relative flex h-12 w-12 shrink-0 items-center justify-center
        rounded-icon
        transition-transform duration-200 ease-out
        hover:scale-[1.08] active:scale-[0.95] active:duration-[80ms]
        focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40
      "
      style={{
        background: palette.bg,
        boxShadow: `0 0 0 0 ${palette.accent}33`,
      }}
    >
      {/* Outer accent glow on hover. We re-declare the box-shadow on
          hover (instead of a transform-only effect) because the glow
          color is brand-specific — Tailwind's ring utility can't
          read a per-app palette without inline style. */}
      <span
        className="
          pointer-events-none absolute inset-0 rounded-icon
          opacity-0 group-hover:opacity-100
          transition-opacity duration-200 ease-out
        "
        aria-hidden
        style={{ boxShadow: `0 0 18px 2px ${palette.accent}33` }}
      />

      {useRemote ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={iconUrl}
          alt=""
          width={28}
          height={28}
          className="h-7 w-7 object-contain"
          referrerPolicy="no-referrer"
        />
      ) : (
        <GlyphFor
          name={palette.glyph}
          className="h-6 w-6 text-white/95"
          aria-hidden
        />
      )}

      {/* Active indicator pill — 4px tall x 12px wide, sits ~6px below the icon. */}
      {active && (
        <span
          className="absolute -bottom-2 left-1/2 h-1 w-3 -translate-x-1/2 rounded-full"
          style={{ background: palette.accent }}
          aria-hidden
        />
      )}
    </Link>
  );
}
