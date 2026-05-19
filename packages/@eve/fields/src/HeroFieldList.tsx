"use client";
import { HeroField, type HeroFieldProps } from "./HeroField";
import type { HeroFieldSize, HeroFieldVariant } from "./types";

// ─── Field definition for the list ────────────────────────────────────────────
// Discriminated unions don't survive Omit + spread (TS narrowing limitation),
// so we keep variant/size on the field type and let the list override at
// render time via explicit prop assignment.

export type HeroFieldDef = HeroFieldProps & {
  /** Unique key for React reconciliation. */
  id: string;
};

// ─── List layout ──────────────────────────────────────────────────────────────

export type HeroFieldListLayout = "grid" | "column" | "row";

export interface HeroFieldListProps {
  fields: HeroFieldDef[];
  variant?: HeroFieldVariant;
  size?: HeroFieldSize;
  /** "grid" tiles into `columns` columns. "column" stacks. "row" wraps inline. */
  layout?: HeroFieldListLayout;
  /** Columns when layout="grid" (default 2). Becomes 1 on narrow screens. */
  columns?: 1 | 2 | 3 | 4;
  /** Gap between fields (Tailwind class fragment, e.g. "2" → gap-2). */
  gap?: 1 | 2 | 3 | 4 | 5 | 6;
  className?: string;
}

const GRID_COLS: Record<1 | 2 | 3 | 4, string> = {
  1: "grid-cols-1",
  2: "grid-cols-1 sm:grid-cols-2",
  3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
  4: "grid-cols-2 lg:grid-cols-4",
};

const GAP: Record<1 | 2 | 3 | 4 | 5 | 6, string> = {
  1: "gap-1",
  2: "gap-2",
  3: "gap-3",
  4: "gap-4",
  5: "gap-5",
  6: "gap-6",
};

/**
 * Render multiple `HeroField`s with a shared layout (grid / column / row).
 * Useful for the engagement-grid pattern (card variant + 2-col grid), settings
 * forms (row variant + column), and sidebar field stacks (inline + column).
 */
export function HeroFieldList({
  fields,
  variant = "inline",
  size = "md",
  layout = "column",
  columns = 2,
  gap,
  className = "",
}: HeroFieldListProps) {
  const resolvedGap = gap ?? (variant === "card" ? 2 : variant === "row" ? 1 : 1);

  const renderItem = (field: HeroFieldDef) => (
    <HeroField
      key={field.id}
      // Spread + override: variant/size from list always win
      {...(field as HeroFieldProps)}
      variant={variant}
      size={size}
    />
  );

  if (layout === "grid") {
    return (
      <div
        className={[
          "grid w-full",
          GRID_COLS[columns],
          GAP[resolvedGap],
          className,
        ].join(" ")}
      >
        {fields.map(renderItem)}
      </div>
    );
  }

  if (layout === "row") {
    return (
      <div
        className={["flex flex-wrap items-center", GAP[resolvedGap], className].join(
          " ",
        )}
      >
        {fields.map(renderItem)}
      </div>
    );
  }

  return (
    <div className={["flex flex-col", GAP[resolvedGap], className].join(" ")}>
      {fields.map(renderItem)}
    </div>
  );
}
