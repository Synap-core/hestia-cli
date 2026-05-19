"use client";
import { useEffect, useRef, useState } from "react";

import type { HeroFieldSize, HeroFieldVariant } from "../types";
import { getValueColor, getValueTypography } from "./cellShared";

interface Props {
  value: string | undefined;
  onChange?: (v: string) => void;
  placeholder?: string;
  /** Initial row count. Textarea grows beyond this as needed. */
  rows?: number;
  /** Max height (px) before scrolling kicks in. */
  maxHeight?: number;
  size?: HeroFieldSize;
  variant?: HeroFieldVariant;
}

/**
 * Multi-line text cell — auto-growing textarea, commit on blur or ⌘/Ctrl+Enter.
 * Always rendered as an editable surface (no read-mode swap) because the typing
 * surface IS the natural display for long-form text.
 */
export function RichTextCell({
  value,
  onChange,
  placeholder = "—",
  rows = 3,
  maxHeight = 320,
  size = "md",
  variant = "inline",
}: Props) {
  const readOnly = !onChange;
  const [draft, setDraft] = useState(value ?? "");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // Re-sync from external changes when the textarea isn't focused
    if (textareaRef.current && document.activeElement !== textareaRef.current) {
      setDraft(value ?? "");
    }
  }, [value]);

  // Auto-grow
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const next = Math.min(el.scrollHeight, maxHeight);
    el.style.height = `${next}px`;
  }, [draft, maxHeight]);

  function commit() {
    if (!onChange) return;
    if (draft !== (value ?? "")) onChange(draft);
  }

  const typography = getValueTypography(size, variant);

  if (readOnly) {
    return (
      <div
        className={[
          "block w-full whitespace-pre-wrap break-words",
          typography,
          getValueColor(Boolean(value)),
        ].join(" ")}
      >
        {value || placeholder}
      </div>
    );
  }

  return (
    <textarea
      ref={textareaRef}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
          e.preventDefault();
          commit();
          textareaRef.current?.blur();
        }
      }}
      placeholder={placeholder}
      rows={rows}
      className={[
        "block w-full bg-transparent outline-none resize-none",
        "whitespace-pre-wrap break-words leading-relaxed",
        typography,
        "text-foreground/85 placeholder:text-foreground/30 caret-primary",
        "transition-colors",
      ].join(" ")}
      style={{ maxHeight }}
    />
  );
}
