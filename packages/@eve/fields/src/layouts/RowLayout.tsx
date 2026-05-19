"use client";
import type { ReactNode } from "react";

import type { FieldIcon, HeroFieldSize } from "../types";

interface Props {
  label: string;
  icon?: FieldIcon;
  iconState?: "filled" | "empty";
  children: ReactNode;
  size?: HeroFieldSize;
  interactive?: boolean;
}

const SIZE_PADDING: Record<HeroFieldSize, string> = {
  sm: "py-1.5",
  md: "py-2",
  lg: "py-2.5",
};

const LABEL_ICON_SIZE = 13;

/**
 * Row layout — form-style. Label on the left, value on the right.
 * Good for property panels, settings, and dense detail views.
 */
export function RowLayout({
  label,
  icon: Icon,
  iconState = "empty",
  children,
  size = "md",
  interactive = true,
}: Props) {
  return (
    <div
      className={[
        "group/field flex items-center justify-between gap-4 rounded-lg -mx-2 px-2 transition-colors",
        SIZE_PADDING[size],
        interactive ? "hover:bg-default-100" : "",
      ].join(" ")}
    >
      <div className="flex items-center gap-2 text-xs text-default-500 shrink-0">
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
      <div className="min-w-0 flex-1 flex justify-end">{children}</div>
    </div>
  );
}
