"use client";

/**
 * `SearchBar` — controlled input wired to the OS Home grid.
 *
 * Behavior (eve-os-home-design.mdx §3.1):
 *   • Cmd+K (or Ctrl+K) anywhere on the page focuses this input.
 *   • Typing emits a debounced 80ms onChange to the parent.
 *   • ESC clears the value.
 *
 * Phase 2A keeps it scoped to "filter the apps grid". v2 broadens search
 * across settings, marketplace, and Synap entities — deferred (§10).
 */

import { Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export interface SearchBarProps {
  /** Debounced — fires 80ms after the latest keystroke. */
  onChange: (value: string) => void;
  /** Optional initial value, useful if state lifts higher later. */
  initialValue?: string;
  placeholder?: string;
}

export function SearchBar({
  onChange,
  initialValue = "",
  placeholder = "Search apps, settings, or commands…",
}: SearchBarProps) {
  const [raw, setRaw] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  // Cmd+K / Ctrl+K — focus from anywhere on the page.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Debounced propagation. 80ms is short enough that the grid feels
  // live but long enough that we don't reflow on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => onChange(raw.trim()), 80);
    return () => clearTimeout(t);
  }, [raw, onChange]);

  function clear() {
    setRaw("");
    inputRef.current?.focus();
  }

  return (
    <div className="relative w-full max-w-xl">
      <Search
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-default-400"
        aria-hidden
      />
      <input
        ref={inputRef}
        type="search"
        value={raw}
        onChange={e => setRaw(e.target.value)}
        onKeyDown={e => {
          if (e.key === "Escape") clear();
        }}
        placeholder={placeholder}
        aria-label="Search apps"
        aria-controls="os-home-grid"
        className="
          w-full h-10 rounded-lg border border-divider bg-content1
          pl-9 pr-9 text-sm text-foreground placeholder:text-default-400
          outline-none transition-colors
          hover:border-default-300
          focus:border-primary/60 focus:bg-content1
        "
      />
      {raw && (
        <button
          type="button"
          onClick={clear}
          aria-label="Clear search"
          className="
            absolute right-2 top-1/2 -translate-y-1/2
            inline-flex h-6 w-6 items-center justify-center rounded-md
            text-default-400 hover:text-foreground hover:bg-content2
            transition-colors
          "
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
      <kbd
        className={
          "pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 " +
          "hidden md:inline-flex items-center gap-0.5 rounded border border-divider " +
          "bg-content2/60 px-1.5 py-0.5 font-mono text-[10px] text-default-500 " +
          (raw ? "opacity-0" : "")
        }
        aria-hidden
      >
        ⌘K
      </kbd>
    </div>
  );
}
