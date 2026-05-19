"use client";
import type { ReactNode } from "react";

import type { FieldIcon, HeroFieldSize } from "../types";

interface Props {
  label: string;
  icon?: FieldIcon;
  iconState?: "filled" | "empty";
  children: ReactNode;
  /** Optional helper text under the value (e.g. relative date, hint). */
  helper?: ReactNode;
  size?: HeroFieldSize;
  interactive?: boolean;
}

const SIZE_PADDING: Record<HeroFieldSize, string> = {
  sm: "p-2.5",
  md: "p-3 sm:p-3.5",
  lg: "p-4",
};

const LABEL_ICON_SIZE = 11;

/**
 * Card layout — stacked, label-on-top. Matches the engagement-grid look.
 * The card itself is the hover surface; the cell child fills the value row.
 */
export function CardLayout({
  label,
  icon: Icon,
  iconState = "empty",
  children,
  helper,
  size = "md",
  interactive = true,
}: Props) {
  return (
    <div
      className={[
        "group/field flex flex-col gap-1.5 rounded-xl border bg-content1/30",
        "border-divider/60 transition-colors",
        SIZE_PADDING[size],
        interactive ? "hover:border-foreground/20 hover:bg-content1/50" : "",
      ].join(" ")}
    >
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.08em] text-foreground/40">
        {Icon ? (
          <Icon
            size={LABEL_ICON_SIZE}
            className={
              iconState === "filled" ? "text-foreground/55" : "text-foreground/30"
            }
          />
        ) : null}
        <span className="truncate">{label}</span>
      </div>
      <div className="min-h-[1.5rem]">{children}</div>
      {helper ? (
        <div className="text-[11px] text-foreground/40 mt-0.5">{helper}</div>
      ) : null}
    </div>
  );
}
