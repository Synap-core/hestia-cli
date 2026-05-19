"use client";
import { useEffect, useMemo, useRef, useState } from "react";

import type { HeroFieldSize, HeroFieldVariant } from "../types";
import {
  getValueColor,
  getValueMinHeight,
  getValueTypography,
} from "./cellShared";

export type NumberFormat = "plain" | "currency" | "percent";

interface Props {
  value: number | undefined;
  onChange?: (v: number | undefined) => void;
  placeholder?: string;
  format?: NumberFormat;
  currency?: string;
  /** Decimal places. Defaults: plain=auto, currency=0, percent=0. */
  precision?: number;
  locale?: string;
  size?: HeroFieldSize;
  variant?: HeroFieldVariant;
  align?: "left" | "right";
}

function defaultPrecision(format: NumberFormat): number {
  if (format === "currency") return 0;
  if (format === "percent") return 0;
  return 2;
}

function formatNumber(
  value: number,
  format: NumberFormat,
  currency: string | undefined,
  precision: number,
  locale: string,
): string {
  if (format === "currency") {
    try {
      return new Intl.NumberFormat(locale, {
        style: "currency",
        currency: currency ?? "USD",
        maximumFractionDigits: precision,
        minimumFractionDigits: 0,
      }).format(value);
    } catch {
      return `${currency ?? "$"}${value.toLocaleString(locale)}`;
    }
  }
  if (format === "percent") {
    return `${value.toLocaleString(locale, {
      maximumFractionDigits: precision,
      minimumFractionDigits: 0,
    })}%`;
  }
  return value.toLocaleString(locale, {
    maximumFractionDigits: precision,
    minimumFractionDigits: 0,
  });
}

/**
 * Number cell — formatted on display (currency / percent / locale), raw on
 * edit. Empty string commits as `undefined` so callers can distinguish
 * "cleared" from "zero".
 */
export function NumberCell({
  value,
  onChange,
  placeholder = "—",
  format = "plain",
  currency,
  precision,
  locale,
  size = "md",
  variant = "inline",
  align = "left",
}: Props) {
  const readOnly = !onChange;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(value != null ? String(value) : "");
  const inputRef = useRef<HTMLInputElement>(null);
  const resolvedPrecision = precision ?? defaultPrecision(format);
  const resolvedLocale =
    locale ??
    (typeof navigator !== "undefined" ? navigator.language : "en-US");

  useEffect(() => {
    if (!editing) setDraft(value != null ? String(value) : "");
  }, [value, editing]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const displayText = useMemo(() => {
    if (value == null || Number.isNaN(value)) return placeholder;
    return formatNumber(value, format, currency, resolvedPrecision, resolvedLocale);
  }, [value, format, currency, resolvedPrecision, resolvedLocale, placeholder]);

  function commit() {
    if (!onChange) {
      setEditing(false);
      return;
    }
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed === "") {
      if (value != null) onChange(undefined);
      return;
    }
    const parsed = Number(trimmed);
    if (Number.isNaN(parsed)) {
      setDraft(value != null ? String(value) : "");
      return;
    }
    if (parsed !== value) onChange(parsed);
  }

  function cancel() {
    setEditing(false);
    setDraft(value != null ? String(value) : "");
  }

  const typography = getValueTypography(size, variant);
  const minHeight = getValueMinHeight(size);
  const sharedClasses = [
    "block w-full bg-transparent outline-none transition-colors truncate tabular-nums",
    typography,
    minHeight,
    align === "right" ? "text-right" : "text-left",
  ].join(" ");

  if (editing && !readOnly) {
    return (
      <input
        ref={inputRef}
        type="number"
        inputMode="decimal"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          }
        }}
        placeholder={placeholder}
        className={[
          sharedClasses,
          "text-foreground placeholder:text-default-400 caret-primary",
        ].join(" ")}
      />
    );
  }

  return (
    <button
      type="button"
      disabled={readOnly}
      onClick={() => !readOnly && setEditing(true)}
      className={[
        sharedClasses,
        getValueColor(value != null && !Number.isNaN(value)),
        !readOnly ? "cursor-text" : "cursor-default",
      ].join(" ")}
    >
      <span className="truncate">{displayText}</span>
    </button>
  );
}
