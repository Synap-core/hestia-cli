"use client";
import type { ReactNode } from "react";

import type { FieldIcon, HeroFieldSize } from "../types";

interface Props {
  icon?: FieldIcon;
  /** Drives icon tier — "filled" when the field has a value. */
  iconState?: "filled" | "empty";
  /** The interactive value cell (display + popover/input). */
  children: ReactNode;
  /** Optional right-side hint or action (chevron, clear button, etc.). */
  trailing?: ReactNode;
  size?: HeroFieldSize;
  /** When false, no hover/cursor affordance is shown (read-only). */
  interactive?: boolean;
  /** Optional accessibility label when no visible label is shown. */
  ariaLabel?: string;
}

const SIZE_PADDING: Record<HeroFieldSize, string> = {
  sm: "py-1 px-2",
  md: "py-1.5 px-2",
  lg: "py-2 px-2.5",
};

const SIZE_ICON: Record<HeroFieldSize, number> = {
  sm: 12,
  md: 13,
  lg: 14,
};

/**
 * Inline layout — sidebar row. Icon + value in a single horizontal line.
 * Surfaces use HeroUI semantic tokens (default-X / divider / foreground) so
 * the field auto-themes with whatever app consumes it.
 */
export function InlineLayout({
  icon: Icon,
  iconState = "empty",
  children,
  trailing,
  size = "md",
  interactive = true,
  ariaLabel,
}: Props) {
  return (
    <div
      aria-label={ariaLabel}
      className={[
        "group/field flex items-center gap-2.5 rounded-lg -mx-2 transition-colors",
        SIZE_PADDING[size],
        interactive ? "hover:bg-default-100" : "",
      ].join(" ")}
    >
      {Icon ? (
        <Icon
          size={SIZE_ICON[size]}
          className={[
            "shrink-0 transition-colors",
            iconState === "filled" ? "text-default-500" : "text-default-400",
          ].join(" ")}
        />
      ) : null}
      <div className="min-w-0 flex-1">{children}</div>
      {trailing ? <div className="shrink-0">{trailing}</div> : null}
    </div>
  );
}
