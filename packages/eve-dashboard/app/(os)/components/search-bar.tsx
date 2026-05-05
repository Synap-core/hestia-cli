"use client";

/**
 * `SearchBar` — Zone D of the Home pane.
 *
 * Capsule-shaped input pinned (visually) at the bottom of the body.
 * Cmd+K (Ctrl+K on Linux/Windows) focuses it from anywhere on the
 * Home. 80ms debounce on input → parent updates the live filter.
 *
 * `Esc` clears the input. Empty state hides the input value but the
 * input keeps focus.
 *
 * See: synap-team-docs/content/team/platform/eve-os-home-design.mdx §6
 */

import { Search } from "lucide-react";
import { useEffect, useRef } from "react";

export interface SearchBarProps {
  value: string;
  onChange: (next: string) => void;
}

const DEBOUNCE_MS = 80;

export function SearchBar({ value, onChange }: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Global Cmd+K / Ctrl+K to focus the input from anywhere on the Home.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isMod = e.metaKey || e.ctrlKey;
      if (isMod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const next = e.target.value;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => onChange(next), DEBOUNCE_MS);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      if (inputRef.current) inputRef.current.value = "";
      onChange("");
    }
  }

  return (
    <div className="px-2 pb-2 pt-2">
      <div className="relative mx-auto w-full max-w-[440px]">
        <Search
          className="
            pointer-events-none absolute left-4 top-1/2 -translate-y-1/2
            h-4 w-4 text-default-500
          "
          aria-hidden
          strokeWidth={2}
        />
        <input
          ref={inputRef}
          type="search"
          aria-controls="home-app-grid"
          aria-label="Search apps"
          autoComplete="off"
          spellCheck={false}
          defaultValue={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="Search apps, agents, anywhere…"
          className="
            block h-11 w-full rounded-full
            border border-white/[0.08] bg-white/[0.05]
            pl-11 pr-12
            text-[13.5px] text-foreground placeholder:text-default-500
            backdrop-blur-md
            transition-[border-color,background,box-shadow] duration-200 ease-out
            focus:border-emerald-400/40 focus:bg-white/[0.08] focus:outline-none
            focus:ring-4 focus:ring-emerald-400/10
          "
        />
        <kbd
          className="
            pointer-events-none absolute right-3 top-1/2 -translate-y-1/2
            inline-flex h-5 items-center justify-center rounded-md
            border border-white/10 bg-white/5
            px-1.5 text-[10px] font-mono text-default-400
          "
          aria-hidden
        >
          ⌘K
        </kbd>
      </div>
    </div>
  );
}
