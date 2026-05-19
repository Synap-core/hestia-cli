"use client";
import { useEffect, useRef, useState } from "react";

import type { HeroFieldSize, HeroFieldVariant } from "../types";
import {
  getValueColor,
  getValueMinHeight,
  getValueTypography,
} from "./cellShared";

export type TextInputKind = "text" | "email" | "phone" | "url";

interface Props {
  value: string | undefined;
  onChange?: (v: string) => void;
  placeholder?: string;
  kind?: TextInputKind;
  size?: HeroFieldSize;
  variant?: HeroFieldVariant;
  align?: "left" | "right";
  /** Auto-format on commit (lowercase emails, trim, etc.). */
  autoFormat?: boolean;
}

const INPUT_TYPE_MAP: Record<TextInputKind, string> = {
  text: "text",
  email: "email",
  phone: "tel",
  url: "url",
};

const INPUT_MODE_MAP: Record<
  TextInputKind,
  "text" | "email" | "tel" | "url"
> = {
  text: "text",
  email: "email",
  phone: "tel",
  url: "url",
};

function format(value: string, kind: TextInputKind, autoFormat: boolean): string {
  if (!autoFormat) return value;
  const trimmed = value.trim();
  if (kind === "email") return trimmed.toLowerCase();
  return trimmed;
}

/**
 * Text-family cell: text, email, phone, url. Click-to-edit with seamless
 * read↔write swap — display and input share identical typography/padding
 * so the caret lands exactly where the text was rendered.
 */
export function TextCell({
  value,
  onChange,
  placeholder = "—",
  kind = "text",
  size = "md",
  variant = "inline",
  align = "left",
  autoFormat = true,
}: Props) {
  const readOnly = !onChange;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  // Re-sync when external value changes (and we're not mid-edit)
  useEffect(() => {
    if (!editing) setDraft(value ?? "");
  }, [value, editing]);

  // Focus on edit-mode enter, place caret at end
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      const len = inputRef.current.value.length;
      inputRef.current.setSelectionRange(len, len);
    }
  }, [editing]);

  function commit() {
    if (!onChange) {
      setEditing(false);
      return;
    }
    const next = format(draft, kind, autoFormat);
    setEditing(false);
    if (next !== (value ?? "")) onChange(next);
    setDraft(next);
  }

  function cancel() {
    setEditing(false);
    setDraft(value ?? "");
  }

  const typography = getValueTypography(size, variant);
  const minHeight = getValueMinHeight(size);

  const sharedClasses = [
    "block w-full bg-transparent outline-none transition-colors truncate",
    typography,
    minHeight,
    align === "right" ? "text-right" : "text-left",
  ].join(" ");

  if (editing && !readOnly) {
    return (
      <input
        ref={inputRef}
        type={INPUT_TYPE_MAP[kind]}
        inputMode={INPUT_MODE_MAP[kind]}
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
        getValueColor(Boolean(value)),
        !readOnly ? "cursor-text" : "cursor-default",
      ].join(" ")}
    >
      <span className="truncate">{value || placeholder}</span>
    </button>
  );
}
