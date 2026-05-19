"use client";
import { resolveFieldIcon } from "./classify";
import {
  BooleanCell,
  DateCell,
  EntityCell,
  MultiEntityCell,
  MultiSelectCell,
  NumberCell,
  RichTextCell,
  SelectCell,
  TextCell,
} from "./cells";
import { CardLayout, InlineLayout, RowLayout } from "./layouts";
import type {
  EntityRef,
  EntitySearchFn,
  FieldIcon,
  FieldOption,
  HeroFieldSize,
  HeroFieldVariant,
} from "./types";

// ─── Common props (shared across every type) ──────────────────────────────────

interface CommonProps {
  /** Shown above the value in card/row variants. Inline uses the icon instead. */
  label?: string;
  /** Override the default icon for the field type. */
  icon?: FieldIcon;
  placeholder?: string;
  variant?: HeroFieldVariant;
  size?: HeroFieldSize;
}

// ─── Discriminated union: one branch per HeroFieldType ────────────────────────

type TextProps = CommonProps & {
  type: "text" | "email" | "phone" | "url";
  value: string | undefined;
  onChange?: (v: string) => void;
  align?: "left" | "right";
};

type NumberProps = CommonProps & {
  type: "number" | "currency" | "percent";
  value: number | undefined;
  onChange?: (v: number | undefined) => void;
  currency?: string;
  precision?: number;
  locale?: string;
  align?: "left" | "right";
};

type DateProps = CommonProps & {
  type: "date";
  value: string | undefined;
  onChange?: (v: string | undefined) => void;
  relative?: boolean;
  align?: "left" | "right";
  locale?: string;
};

type SingleSelectProps = CommonProps & {
  type: "select" | "status";
  value: string | undefined;
  onChange?: (v: string | undefined) => void;
  options: FieldOption[];
  allowCustom?: boolean;
  align?: "left" | "right";
};

type MultiSelectProps = CommonProps & {
  type: "multi-select" | "tags";
  value: string[] | undefined;
  onChange?: (v: string[]) => void;
  options?: FieldOption[];
  allowCustom?: boolean;
};

type EntityProps = CommonProps & {
  type: "entity";
  value: EntityRef | undefined;
  onChange?: (v: EntityRef | undefined) => void;
  searchEntities: EntitySearchFn;
  searchPlaceholder?: string;
};

type MultiEntityProps = CommonProps & {
  type: "multi-entity";
  value: EntityRef[] | undefined;
  onChange?: (v: EntityRef[]) => void;
  searchEntities: EntitySearchFn;
  searchPlaceholder?: string;
};

type BooleanProps = CommonProps & {
  type: "boolean";
  value: boolean | undefined;
  onChange?: (v: boolean) => void;
  trueLabel?: string;
  falseLabel?: string;
  appearance?: "switch" | "checkbox";
};

type RichTextProps = CommonProps & {
  type: "richtext";
  value: string | undefined;
  onChange?: (v: string) => void;
  rows?: number;
  maxHeight?: number;
};

export type HeroFieldProps =
  | TextProps
  | NumberProps
  | DateProps
  | SingleSelectProps
  | MultiSelectProps
  | EntityProps
  | MultiEntityProps
  | BooleanProps
  | RichTextProps;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hasValue(props: HeroFieldProps): boolean {
  switch (props.type) {
    case "text":
    case "email":
    case "phone":
    case "url":
    case "richtext":
      return Boolean(props.value && props.value.length > 0);
    case "number":
    case "currency":
    case "percent":
      return props.value != null && !Number.isNaN(props.value);
    case "date":
      return Boolean(props.value);
    case "select":
    case "status":
      return Boolean(props.value);
    case "multi-select":
    case "tags":
      return (props.value?.length ?? 0) > 0;
    case "entity":
      return Boolean(props.value);
    case "multi-entity":
      return (props.value?.length ?? 0) > 0;
    case "boolean":
      return props.value != null;
  }
}

function humanizeLabel(type: HeroFieldProps["type"]): string {
  return type
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── Cell renderer ────────────────────────────────────────────────────────────

function renderCell(props: HeroFieldProps) {
  const { variant = "inline", size = "md", placeholder } = props;
  const align =
    "align" in props
      ? props.align
      : variant === "row"
        ? "right"
        : "left";

  switch (props.type) {
    case "text":
    case "email":
    case "phone":
    case "url":
      return (
        <TextCell
          value={props.value}
          onChange={props.onChange}
          placeholder={placeholder}
          kind={props.type}
          size={size}
          variant={variant}
          align={align}
        />
      );

    case "number":
    case "currency":
    case "percent":
      return (
        <NumberCell
          value={props.value}
          onChange={props.onChange}
          placeholder={placeholder}
          format={
            props.type === "currency"
              ? "currency"
              : props.type === "percent"
                ? "percent"
                : "plain"
          }
          currency={props.currency}
          precision={props.precision}
          locale={props.locale}
          size={size}
          variant={variant}
          align={align}
        />
      );

    case "date":
      return (
        <DateCell
          value={props.value}
          onChange={props.onChange}
          placeholder={placeholder}
          relative={props.relative}
          locale={props.locale}
          size={size}
          variant={variant}
          align={align}
        />
      );

    case "select":
    case "status":
      return (
        <SelectCell
          value={props.value}
          onChange={props.onChange}
          placeholder={placeholder}
          options={props.options}
          appearance={props.type}
          allowCustom={props.allowCustom}
          size={size}
          variant={variant}
          align={align}
        />
      );

    case "multi-select":
    case "tags":
      return (
        <MultiSelectCell
          value={props.value}
          onChange={props.onChange}
          placeholder={placeholder}
          options={props.options}
          appearance={props.type === "tags" ? "tags" : "select"}
          allowCustom={props.allowCustom}
          size={size}
          variant={variant}
        />
      );

    case "entity":
      return (
        <EntityCell
          value={props.value}
          onChange={props.onChange}
          placeholder={placeholder}
          searchEntities={props.searchEntities}
          searchPlaceholder={props.searchPlaceholder}
          size={size}
          variant={variant}
        />
      );

    case "multi-entity":
      return (
        <MultiEntityCell
          value={props.value}
          onChange={props.onChange}
          placeholder={placeholder}
          searchEntities={props.searchEntities}
          searchPlaceholder={props.searchPlaceholder}
          size={size}
          variant={variant}
        />
      );

    case "boolean":
      return (
        <BooleanCell
          value={props.value}
          onChange={props.onChange}
          appearance={props.appearance}
          trueLabel={props.trueLabel}
          falseLabel={props.falseLabel}
          size={size}
          variant={variant}
        />
      );

    case "richtext":
      return (
        <RichTextCell
          value={props.value}
          onChange={props.onChange}
          placeholder={placeholder}
          rows={props.rows}
          maxHeight={props.maxHeight}
          size={size}
          variant={variant}
        />
      );
  }
}

// ─── Main component ───────────────────────────────────────────────────────────

/**
 * Single property field for HeroUI apps. One component renders any of 16+ field
 * types in three layout variants (inline, card, row), with seamless read↔write
 * transitions handled by the underlying cell. Read-only when `onChange` is
 * omitted.
 */
export function HeroField(props: HeroFieldProps) {
  const {
    type,
    label,
    icon,
    variant = "inline",
    size = "md",
  } = props;

  const Icon = resolveFieldIcon(type, icon);
  const iconState: "filled" | "empty" = hasValue(props) ? "filled" : "empty";
  const interactive = "onChange" in props && Boolean(props.onChange);
  const resolvedLabel = label ?? humanizeLabel(type);
  const cell = renderCell(props);

  if (variant === "card") {
    return (
      <CardLayout
        label={resolvedLabel}
        icon={Icon}
        iconState={iconState}
        size={size}
        interactive={interactive}
      >
        {cell}
      </CardLayout>
    );
  }

  if (variant === "row") {
    return (
      <RowLayout
        label={resolvedLabel}
        icon={Icon}
        iconState={iconState}
        size={size}
        interactive={interactive}
      >
        {cell}
      </RowLayout>
    );
  }

  return (
    <InlineLayout
      icon={Icon}
      iconState={iconState}
      size={size}
      interactive={interactive}
      ariaLabel={resolvedLabel}
    >
      {cell}
    </InlineLayout>
  );
}
