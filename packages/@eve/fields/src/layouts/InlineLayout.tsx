"use client";
import type { ReactNode } from "react";

import type { FieldIcon, HeroFieldSize } from "../types";

interface Props {
  icon?: FieldIcon;
  /** Drives icon brightness — "filled" when the field has a value. */
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
 * The layout itself never carries onClick: the cell child is responsible for
 * its own trigger so popovers/inputs always have a stable anchor.
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
        interactive
          ? "hover:bg-content1/70"
          : "",
      ].join(" ")}
    >
      {Icon ? (
        <Icon
          size={SIZE_ICON[size]}
          className={[
            "shrink-0 transition-colors",
            iconState === "filled" ? "text-foreground/45" : "text-foreground/25",
          ].join(" ")}
        />
      ) : null}
      <div className="min-w-0 flex-1">{children}</div>
      {trailing ? <div className="shrink-0">{trailing}</div> : null}
    </div>
  );
}
