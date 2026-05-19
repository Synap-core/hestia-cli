import type { ComponentType } from "react";

// ─── Field types ──────────────────────────────────────────────────────────────

export type HeroFieldType =
  | "text"
  | "email"
  | "phone"
  | "url"
  | "number"
  | "currency"
  | "percent"
  | "date"
  | "select"
  | "status"
  | "multi-select"
  | "tags"
  | "entity"
  | "multi-entity"
  | "boolean"
  | "richtext";

export type HeroFieldVariant = "inline" | "card" | "row";

export type HeroFieldSize = "sm" | "md" | "lg";

// ─── Color tokens for chips ───────────────────────────────────────────────────
// Tailwind cannot generate class names dynamically, so we restrict to a fixed
// palette and rely on a static class map in colors.ts. All colors are tuned for
// the HeroUI dark-leaning theme used across Synap apps.

export type ChipColor =
  | "slate"
  | "neutral"
  | "emerald"
  | "amber"
  | "rose"
  | "violet"
  | "sky"
  | "blue"
  | "indigo"
  | "fuchsia"
  | "teal"
  | "cyan";

// ─── Field options (for select / status / multi-select / tags) ────────────────

export interface FieldOption {
  value: string;
  label: string;
  /** For status: drives chip color. For select: optional decoration. */
  color?: ChipColor;
  /** Optional secondary text shown below label in the dropdown. */
  description?: string;
  /** Optional leading icon for the option (shown in trigger + dropdown). */
  icon?: ComponentType<{ size?: number; className?: string }>;
}

// ─── Entity references (for entity / multi-entity) ────────────────────────────

export interface EntityRef {
  id: string;
  name: string;
  type?: string;
  avatar?: string;
  /** Optional secondary line (e.g. company name under a contact's name). */
  subtitle?: string;
}

export type EntitySearchFn = (
  query: string,
) => Promise<EntityRef[]> | EntityRef[];

// ─── Shared icon type ─────────────────────────────────────────────────────────

export type FieldIcon = ComponentType<{ size?: number; className?: string }>;
