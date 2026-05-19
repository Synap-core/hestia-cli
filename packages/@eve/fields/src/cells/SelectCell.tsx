"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Select, SelectItem } from "@heroui/react";

import { getChipClasses } from "../colors";
import type {
  FieldOption,
  HeroFieldSize,
  HeroFieldVariant,
} from "../types";
import {
  getValueColor,
  getValueMinHeight,
  getValueTypography,
} from "./cellShared";

interface Props {
  value: string | undefined;
  onChange?: (v: string | undefined) => void;
  placeholder?: string;
  options: FieldOption[];
  /** "select" = plain text. "status" = colored chip in trigger + dropdown. */
  appearance?: "select" | "status";
  size?: HeroFieldSize;
  variant?: HeroFieldVariant;
  align?: "left" | "right";
  allowCustom?: boolean;
}

const CUSTOM_KEY = "__custom__";

/** Renders a tiny colored dot + label for status options. */
function StatusDot({ color }: { color?: FieldOption["color"] }) {
  const classes = getChipClasses(color);
  return (
    <span
      className={`inline-block w-1.5 h-1.5 rounded-full ${classes.dot} shrink-0`}
    />
  );
}

/** Pill-style chip for status display in the trigger. */
function StatusChip({ option }: { option: FieldOption }) {
  const classes = getChipClasses(option.color);
  return (
    <span
      className={[
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border",
        "text-[11px] font-medium tracking-tight",
        classes.bg,
        classes.text,
        classes.border,
      ].join(" ")}
    >
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${classes.dot}`} />
      {option.label}
    </span>
  );
}

/**
 * Single-select cell. Status variant renders a colored chip; plain select
 * renders the option label as text. Both use HeroUI's Select under the hood
 * for accessibility, keyboard nav, and animation.
 */
export function SelectCell({
  value,
  onChange,
  placeholder = "—",
  options,
  appearance = "select",
  size = "md",
  variant = "inline",
  align = "left",
  allowCustom = false,
}: Props) {
  const readOnly = !onChange;
  const [customMode, setCustomMode] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const isCustomValue = Boolean(
    value && !options.find((o) => o.value === value),
  );
  const selectedKeys = value
    ? new Set([isCustomValue ? CUSTOM_KEY : value])
    : new Set<string>();

  const selectedOption = useMemo(
    () => options.find((o) => o.value === value),
    [options, value],
  );

  useEffect(() => {
    if (customMode) inputRef.current?.focus();
  }, [customMode]);

  function handleSelectionChange(keys: "all" | Set<React.Key>) {
    if (!onChange) return;
    const key = Array.from(keys as Set<string>)[0];
    if (!key) return;
    if (key === CUSTOM_KEY) {
      setDraft(isCustomValue ? value! : "");
      setCustomMode(true);
    } else {
      onChange(key);
    }
  }

  function commitCustom() {
    if (!onChange) return;
    const next = draft.trim();
    setCustomMode(false);
    if (next === "") return;
    onChange(next);
    setDraft("");
  }

  function cancelCustom() {
    setCustomMode(false);
    setDraft("");
  }

  const typography = getValueTypography(size, variant);
  const minHeight = getValueMinHeight(size);

  // ─── Inline custom-value input mode ─────────────────────────────────────────
  if (customMode && !readOnly) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commitCustom}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commitCustom();
          } else if (e.key === "Escape") {
            e.preventDefault();
            cancelCustom();
          }
        }}
        placeholder="Type custom value…"
        className={[
          "block w-full bg-transparent outline-none transition-colors",
          typography,
          minHeight,
          "text-foreground placeholder:text-foreground/30 caret-primary",
          align === "right" ? "text-right" : "text-left",
        ].join(" ")}
      />
    );
  }

  // ─── Read-only mode: just show the value ────────────────────────────────────
  if (readOnly) {
    const text = isCustomValue ? value : selectedOption?.label;
    if (appearance === "status" && selectedOption) {
      return <StatusChip option={selectedOption} />;
    }
    return (
      <div
        className={[
          "block w-full transition-colors truncate",
          typography,
          minHeight,
          align === "right" ? "text-right" : "text-left",
          getValueColor(Boolean(text)),
        ].join(" ")}
      >
        <span className="truncate">{text || placeholder}</span>
      </div>
    );
  }

  // ─── HeroUI Select with styled trigger ──────────────────────────────────────
  return (
    <Select
      aria-label={placeholder}
      selectedKeys={selectedKeys}
      onSelectionChange={handleSelectionChange}
      placeholder={placeholder}
      variant="flat"
      size="sm"
      disallowEmptySelection={false}
      renderValue={() => {
        if (isCustomValue && value) {
          // Custom value displayed as plain text or a neutral chip
          if (appearance === "status") {
            return (
              <StatusChip option={{ value, label: value, color: "neutral" }} />
            );
          }
          return <span className="truncate">{value}</span>;
        }
        if (selectedOption) {
          return appearance === "status" ? (
            <StatusChip option={selectedOption} />
          ) : (
            <span className="truncate">{selectedOption.label}</span>
          );
        }
        return <span className="italic text-foreground/35">{placeholder}</span>;
      }}
      classNames={{
        base: "w-full",
        trigger: [
          "bg-transparent shadow-none border-none rounded-lg",
          "px-0 h-auto min-h-0 py-0",
          "data-[hover=true]:bg-transparent",
          "data-[focus=true]:bg-transparent",
          minHeight,
        ].join(" "),
        innerWrapper: [typography, "py-0"].join(" "),
        value: getValueColor(Boolean(selectedOption || isCustomValue)),
        selectorIcon: "text-foreground/30 right-0",
        popoverContent: [
          "bg-background/95 backdrop-blur-xl border border-divider rounded-xl",
          "shadow-lg p-0 min-w-[200px]",
        ].join(" "),
        listbox: "p-1",
      }}
    >
      {[
        ...options.map((opt) => (
          <SelectItem
            key={opt.value}
            startContent={
              appearance === "status" ? <StatusDot color={opt.color} /> : null
            }
            classNames={{
              base: "rounded-lg data-[hover=true]:bg-content1",
              title: "text-[13px] text-foreground/85",
              description: "text-[11px] text-foreground/45",
            }}
            description={opt.description}
          >
            {opt.label}
          </SelectItem>
        )),
        ...(allowCustom
          ? [
              <SelectItem
                key={CUSTOM_KEY}
                classNames={{
                  base: "rounded-lg data-[hover=true]:bg-content1 border-t border-divider/60 mt-1 pt-1 rounded-t-none",
                  title: "text-[12px] italic text-foreground/45",
                }}
              >
                Other…
              </SelectItem>,
            ]
          : []),
      ]}
    </Select>
  );
}
