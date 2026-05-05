"use client";

/**
 * `AddAppIcon` — dashed `+` terminator at the end of the Home grid.
 *
 * Same bounding box as a real `AppIcon` so the grid stays aligned.
 * Dashed border + transparent fill — read as "add", not "app". The
 * 2.5D recipe deliberately does NOT apply: we want this to feel like
 * empty real estate, not a pressed tile.
 *
 * Click target is configurable so the parent (Home) can wire it to
 * either the in-OS `/marketplace` route (default) or, occasionally,
 * an external URL.
 *
 * See: synap-team-docs/content/team/platform/eve-os-home-design.mdx §5.6
 */

import Link from "next/link";
import { Plus } from "lucide-react";

export interface AddAppIconProps {
  href: string;
  /** Open in a new tab. Defaults to false — the marketplace is in-OS now. */
  external?: boolean;
}

export function AddAppIcon({ href, external = false }: AddAppIconProps) {
  const Tag = external ? ("a" as const) : Link;
  const externalAttrs = external
    ? { target: "_blank", rel: "noreferrer" }
    : {};
  return (
    <Tag
      href={href}
      {...externalAttrs}
      aria-label="Browse marketplace"
      className="
        group flex w-full max-w-[112px] flex-col items-center gap-2.5
        focus:outline-none focus-visible:rounded-app-icon
        focus-visible:ring-2 focus-visible:ring-emerald-400/40
      "
    >
      <span
        className="
          flex h-16 w-16 items-center justify-center rounded-app-icon
          border border-dashed border-default-400/60
          text-default-400
          transition-all duration-200 ease-out
          group-hover:scale-[1.04] group-active:scale-[0.96]
          group-hover:border-default-300 group-hover:text-default-200
          sm:h-[72px] sm:w-[72px]
          md:h-20 md:w-20
        "
      >
        <Plus className="h-7 w-7" strokeWidth={1.6} aria-hidden />
      </span>
      <span className="text-[12.5px] font-medium text-default-500 group-hover:text-default-300 transition-colors">
        Add
      </span>
    </Tag>
  );
}
