/**
 * Schema-driven field builder for `EntityDetailRenderer`.
 *
 * Replaces the old value-only `classifyValue()` path with a 5-tier dispatch
 * mirroring Synap Studio's Tamagui `FieldRenderer`:
 *
 *   1. `uiHints.inputType` (explicit — `select` / `email` / `markdown` / …)
 *   2. `uiHints.displayAs` (semantic — `status` / `priority`)
 *   3. Slug pattern  (`*status` → status field, `*priority` → priority)
 *   4. `constraints.enum`  (any enum → select)
 *   5. `valueType` (final fallback — `boolean` / `date` / `entity_id` / …)
 *
 * When no property def is supplied (AI-added properties, untyped data) the
 * builder falls back to `classifyValue()` so the field still renders
 * sensibly. This keeps the system robust as schemas evolve.
 *
 * Spec: synap-team-docs/content/team/platform/profile-renderer.mdx
 */

import { classifyValue } from "@eve/fields";
import type {
  ChipColor,
  FieldOption,
  HeroFieldDef,
  HeroFieldType,
} from "@eve/fields";

import { priorityColorFor, statusColorFor } from "./color-maps";

/**
 * Subset of `EffectiveProperty` from `@synap/database`. Inlined here so the
 * builder has no backend type dep — fields we don't use are omitted.
 */
export interface EffectivePropertyDef {
  id: string;
  slug: string;
  valueType: string;
  constraints?: Record<string, unknown> | null;
  uiHints?: Record<string, unknown> | null;
  targetProfileId?: string | null;
  required?: boolean;
  defaultValue?: unknown;
  displayOrder?: number;
}

export interface BuildFieldArgs {
  key: string;
  value: unknown;
  def?: EffectivePropertyDef;
  onChange: (next: unknown) => void;
}

/**
 * Build a `HeroFieldDef` for one property. The dispatch tier that matched
 * is recorded in `_dispatchedBy` (debug-only — strip before passing to
 * HeroField if needed).
 */
export function buildSchemaAwareField(args: BuildFieldArgs): HeroFieldDef {
  if (args.def) {
    return buildFromDef(args);
  }
  return buildFromClassify(args);
}

// ─── With schema ─────────────────────────────────────────────────────────────

function buildFromDef(args: BuildFieldArgs): HeroFieldDef {
  const def = args.def!;
  const uiHints = (def.uiHints ?? {}) as Record<string, unknown>;
  const constraints = (def.constraints ?? {}) as Record<string, unknown>;
  const label = pickLabel(uiHints, def.slug);
  const placeholder = pickPlaceholder(uiHints);
  const slugLower = def.slug.toLowerCase();

  // 1. Explicit inputType
  const inputType = typeof uiHints.inputType === "string" ? uiHints.inputType : undefined;
  if (inputType) {
    const fromInput = buildFromInputType({
      args,
      label,
      placeholder,
      inputType,
      constraints,
    });
    if (fromInput) return fromInput;
  }

  // 2. displayAs semantic + slug patterns
  const displayAs = typeof uiHints.displayAs === "string" ? uiHints.displayAs : undefined;
  if (displayAs === "status" || /status$/.test(slugLower)) {
    return buildStatusField(args, label, enumFromConstraints(constraints));
  }
  if (displayAs === "priority" || /priority/.test(slugLower)) {
    return buildPriorityField(args, label, enumFromConstraints(constraints));
  }

  // 3. constraints.enum → select
  const enumValues = enumFromConstraints(constraints);
  if (enumValues) {
    return buildSelectField(args, label, enumValues);
  }

  // 4. valueType
  return buildFromValueType(args, label, placeholder, def.valueType);
}

function buildFromInputType(p: {
  args: BuildFieldArgs;
  label: string;
  placeholder?: string;
  inputType: string;
  constraints: Record<string, unknown>;
}): HeroFieldDef | null {
  const { args, label, placeholder, inputType, constraints } = p;
  switch (inputType) {
    case "email":
    case "phone":
    case "url":
      return {
        id: args.key,
        type: inputType as HeroFieldType,
        label,
        placeholder,
        value: stringValue(args.value),
        onChange: (v) => args.onChange(v),
      };

    case "select": {
      const e = enumFromConstraints(constraints);
      if (e) return buildSelectField(args, label, e);
      return null;
    }

    case "checkbox":
      return {
        id: args.key,
        type: "boolean",
        label,
        value: booleanValue(args.value),
        onChange: (v) => args.onChange(v),
      };

    case "tags":
      return {
        id: args.key,
        type: "tags",
        label,
        value: arrayValue(args.value),
        allowCustom: true,
        onChange: (v) => args.onChange(v),
      };

    case "markdown":
    case "richtext":
      return {
        id: args.key,
        type: "richtext",
        label,
        placeholder,
        value: stringValue(args.value),
        rows: 4,
        onChange: (v) => args.onChange(v),
      };

    case "datetime":
    case "datetime-local":
    case "date":
      return {
        id: args.key,
        type: "date",
        label,
        value: dateValue(args.value),
        relative: true,
        onChange: (v) => args.onChange(v),
      };

    case "entity-select":
      // We render the chip elsewhere; field is informational text here.
      return {
        id: args.key,
        type: "text",
        label,
        value: stringValue(args.value),
      };

    default:
      return null;
  }
}

function buildStatusField(
  args: BuildFieldArgs,
  label: string,
  enumValues: string[] | undefined,
): HeroFieldDef {
  const options: FieldOption[] = (enumValues ?? [String(args.value ?? "")])
    .filter(Boolean)
    .map((v) => ({
      value: v,
      label: humanize(v),
      color: statusColorFor(v) as ChipColor,
    }));

  return {
    id: args.key,
    type: "status",
    label,
    value: stringValue(args.value),
    options,
    allowCustom: true,
    onChange: (v) => args.onChange(v),
  };
}

function buildPriorityField(
  args: BuildFieldArgs,
  label: string,
  enumValues: string[] | undefined,
): HeroFieldDef {
  const values = enumValues ?? ["low", "medium", "high", "urgent"];
  const options: FieldOption[] = values.map((v) => ({
    value: v,
    label: humanize(v),
    color: priorityColorFor(v) as ChipColor,
  }));

  return {
    id: args.key,
    type: "status",
    label,
    value: stringValue(args.value),
    options,
    onChange: (v) => args.onChange(v),
  };
}

function buildSelectField(
  args: BuildFieldArgs,
  label: string,
  enumValues: string[],
): HeroFieldDef {
  return {
    id: args.key,
    type: "select",
    label,
    value: stringValue(args.value),
    options: enumValues.map((v) => ({ value: v, label: humanize(v) })),
    onChange: (v) => args.onChange(v),
  };
}

function buildFromValueType(
  args: BuildFieldArgs,
  label: string,
  placeholder: string | undefined,
  valueType: string,
): HeroFieldDef {
  switch (valueType) {
    case "boolean":
      return {
        id: args.key,
        type: "boolean",
        label,
        value: booleanValue(args.value),
        onChange: (v) => args.onChange(v),
      };

    case "date":
      return {
        id: args.key,
        type: "date",
        label,
        value: dateValue(args.value),
        relative: true,
        onChange: (v) => args.onChange(v),
      };

    case "number":
      return {
        id: args.key,
        type: "number",
        label,
        value: numberValue(args.value),
        onChange: (v) => args.onChange(v),
      };

    case "entity_id":
      // Inline entity references render as the raw UUID for now — proper
      // EntityChip integration is a follow-up in the field surface
      // (would require fetching the target entity name).
      return {
        id: args.key,
        type: "text",
        label,
        value: stringValue(args.value),
      };

    case "array":
      return {
        id: args.key,
        type: "tags",
        label,
        value: arrayValue(args.value),
        allowCustom: true,
        onChange: (v) => args.onChange(v),
      };

    case "secret":
      return {
        id: args.key,
        type: "text",
        label,
        value: stringValue(args.value) ? "••••••••" : undefined,
      };

    case "object":
      return {
        id: args.key,
        type: "text",
        label,
        value:
          typeof args.value === "string"
            ? args.value
            : JSON.stringify(args.value),
      };

    case "string":
    default:
      return {
        id: args.key,
        type: "text",
        label,
        placeholder,
        value: stringValue(args.value),
        onChange: (v) => args.onChange(v),
      };
  }
}

// ─── Without schema (existing classifyValue fallback) ────────────────────────

function buildFromClassify(args: BuildFieldArgs): HeroFieldDef {
  const type = classifyValue(args.value, args.key);
  const label = humanize(args.key);

  switch (type) {
    case "text":
    case "email":
    case "phone":
    case "url":
      return {
        id: args.key,
        type,
        label,
        value: stringValue(args.value),
        onChange: (v) => args.onChange(v),
      };

    case "number":
    case "currency":
    case "percent":
      return {
        id: args.key,
        type,
        label,
        value: numberValue(args.value),
        onChange: (v) => args.onChange(v),
      };

    case "date":
      return {
        id: args.key,
        type: "date",
        label,
        value: dateValue(args.value),
        relative: true,
        onChange: (v) => args.onChange(v),
      };

    case "boolean":
      return {
        id: args.key,
        type: "boolean",
        label,
        value: booleanValue(args.value),
        onChange: (v) => args.onChange(v),
      };

    case "richtext":
      return {
        id: args.key,
        type: "richtext",
        label,
        value: stringValue(args.value),
        rows: 3,
        onChange: (v) => args.onChange(v),
      };

    case "tags":
      return {
        id: args.key,
        type: "tags",
        label,
        value: arrayValue(args.value),
        allowCustom: true,
        onChange: (v) => args.onChange(v),
      };

    default:
      return {
        id: args.key,
        type: "text",
        label,
        value:
          typeof args.value === "string"
            ? args.value
            : JSON.stringify(args.value),
        onChange: (v) => args.onChange(v),
      };
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pickLabel(uiHints: Record<string, unknown>, slug: string): string {
  const explicit = uiHints.displayName;
  if (typeof explicit === "string" && explicit.trim()) return explicit;
  return humanize(slug);
}

function pickPlaceholder(uiHints: Record<string, unknown>): string | undefined {
  const p = uiHints.placeholder;
  return typeof p === "string" ? p : undefined;
}

function enumFromConstraints(
  constraints: Record<string, unknown>,
): string[] | undefined {
  const e = constraints.enum;
  if (!Array.isArray(e)) return undefined;
  const strings = e.filter((x): x is string => typeof x === "string");
  return strings.length > 0 ? strings : undefined;
}

function stringValue(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (v == null) return undefined;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return undefined;
}

function numberValue(v: unknown): number | undefined {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function booleanValue(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  return undefined;
}

function arrayValue(v: unknown): string[] | undefined {
  if (Array.isArray(v)) return v.map(String);
  return undefined;
}

function dateValue(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (v instanceof Date) return v.toISOString();
  return undefined;
}

function humanize(s: string): string {
  return s.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
