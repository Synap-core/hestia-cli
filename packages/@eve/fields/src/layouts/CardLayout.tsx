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
 * Card layout — stacked, label-on-top. The engagement-grid look. Surfaces
 * are pure HeroUI tokens (bg-default-50, border-divider) so the card picks
 * up whatever brand the host app's theme defines.
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
        "group/field flex flex-col gap-1.5 rounded-xl border bg-default-50 border-divider transition-colors",
        SIZE_PADDING[size],
        interactive ? "hover:bg-default-100" : "",
      ].join(" ")}
    >
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.08em] text-default-500">
        {Icon ? (
          <Icon
            size={LABEL_ICON_SIZE}
            className={
              iconState === "filled" ? "text-default-500" : "text-default-400"
            }
          />
        ) : null}
        <span className="truncate">{label}</span>
      </div>
      <div className="min-h-[1.5rem]">{children}</div>
      {helper ? (
        <div className="text-[11px] text-default-400 mt-0.5">{helper}</div>
      ) : null}
    </div>
  );
}
