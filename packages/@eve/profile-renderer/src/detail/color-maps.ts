/**
 * Status & priority color palettes — ported from Synap Studio's Tamagui
 * `FieldRenderer`.
 *
 * Each map returns a `ChipColor` from `@eve/fields` (Tailwind palette name)
 * so the rendered chip auto-themes with the rest of Eve OS. The status map
 * accepts common english + machine-readable variants ('in-progress',
 * 'in_progress', 'doing') so workspaces with slightly different vocabulary
 * still get sensible defaults.
 *
 * Spec parity: synap-app/apps/studio/components/entity-view/FieldRenderer.tsx
 */

import type { ChipColor } from "@eve/fields";

const STATUS_COLOR: Record<string, ChipColor> = {
  todo: "neutral",
  "in-progress": "blue",
  in_progress: "blue",
  doing: "blue",
  done: "emerald",
  completed: "emerald",
  cancelled: "rose",
  canceled: "rose",
  blocked: "amber",
  active: "blue",
  draft: "neutral",
  archived: "neutral",
  open: "blue",
  closed: "neutral",
  lead: "violet",
  prospect: "violet",
  won: "emerald",
  lost: "rose",
};

const PRIORITY_COLOR: Record<string, ChipColor> = {
  p0: "rose",
  p1: "amber",
  p2: "blue",
  p3: "neutral",
  high: "rose",
  medium: "amber",
  low: "neutral",
  urgent: "rose",
  normal: "neutral",
};

const FALLBACK_PALETTE: ChipColor[] = [
  "blue",
  "emerald",
  "violet",
  "amber",
  "rose",
  "cyan",
  "indigo",
  "teal",
  "fuchsia",
  "sky",
];

/**
 * Resolve a chip color for a status value. Case-insensitive. Falls through
 * to a deterministic palette rotation when no known mapping exists, so two
 * workspaces with custom statuses still get a stable color per value.
 */
export function statusColorFor(value: string | null | undefined): ChipColor {
  if (!value) return "neutral";
  const key = value.toLowerCase().trim();
  return STATUS_COLOR[key] ?? rotatingColor(key);
}

export function priorityColorFor(value: string | null | undefined): ChipColor {
  if (!value) return "neutral";
  const key = value.toLowerCase().trim();
  return PRIORITY_COLOR[key] ?? rotatingColor(key);
}

/**
 * Stable color rotation for unknown enum values — hashes the value to an
 * index in `FALLBACK_PALETTE` so the same string always picks the same
 * color across re-renders.
 */
function rotatingColor(key: string): ChipColor {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return FALLBACK_PALETTE[hash % FALLBACK_PALETTE.length];
}
