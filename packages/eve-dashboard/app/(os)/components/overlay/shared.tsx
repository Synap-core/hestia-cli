"use client";

/**
 * Shared primitives for overlay surfaces.
 * All overlays use the same visionOS glass-icon recipe as the dock.
 */

import {
  Box, Home, Sparkles, Inbox, Activity, Store,
  Settings as SettingsIcon, MessageSquare,
  Paperclip, Wrench, Cpu, Rss, Users, LayoutGrid,
  type LucideIcon,
} from "lucide-react";
import { brandColorFor } from "../../lib/brand-colors";

export const GLYPHS: Record<string, LucideIcon> = {
  Home, Sparkles, Inbox, Activity, Store, Settings: SettingsIcon,
  MessageSquare, Paperclip, Wrench, Cpu, Rss, Users, LayoutGrid,
};

export function OverlayIcon({
  slug,
  iconUrl,
  size = "sm",
}: {
  slug: string;
  iconUrl?: string | null;
  size?: "sm" | "md" | "lg";
}) {
  const palette = brandColorFor(slug);
  const Glyph = palette.glyph ? (GLYPHS[palette.glyph] ?? Box) : Box;

  const dims = size === "lg" ? "h-14 w-14" : size === "md" ? "h-10 w-10" : "h-7 w-7";
  const glyphDims = size === "lg" ? "h-6 w-6" : size === "md" ? "h-5 w-5" : "h-3.5 w-3.5";
  const imgDims = size === "lg" ? "h-9 w-9" : size === "md" ? "h-6 w-6" : "h-[18px] w-[18px]";

  return (
    <span
      className={`glass-icon flex shrink-0 items-center justify-center ${dims}`}
      style={{ background: palette.bg }}
    >
      {!palette.glyph && iconUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={iconUrl}
          alt=""
          className={`rounded-[5px] object-cover ${imgDims}`}
          referrerPolicy="no-referrer"
        />
      ) : (
        <Glyph className={`text-white ${glyphDims}`} strokeWidth={2} aria-hidden />
      )}
    </span>
  );
}

export function brandAccentFor(slug: string): string {
  return brandColorFor(slug).accent;
}
