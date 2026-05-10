"use client";

/**
 * `SearchBar` — Zone D of the Home pane.
 *
 * HeroUI `Input` (variant="flat") so the surface, focus ring, and text
 * colors all flow from the centralized theme. Cmd+K (Ctrl+K on Linux/
 * Windows) focuses the input from anywhere on the Home; 80ms debounce
 * on input → parent updates the live filter; Esc clears.
 *
 * Visual: capsule pill, frosted glass, subtle inner ring. The ⌘K hint
 * sits in `endContent` so the search icon and shortcut share the same
 * input chrome.
 *
 * See: synap-team-docs/content/team/platform/eve-os-home-design.mdx §6
 */

import { Input, Kbd } from "@heroui/react";
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
      <div className="mx-auto w-full max-w-[460px]">
        <Input
          ref={inputRef}
          type="search"
          aria-controls="home-app-grid"
          aria-label="Search apps, agents, or anywhere"
          autoComplete="off"
          spellCheck="false"
          defaultValue={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="Search apps, agents, anywhere…"
          variant="flat"
          radius="full"
          startContent={
            <Search className="h-4 w-4 text-foreground/55" strokeWidth={2} aria-hidden />
          }
          endContent={<Kbd keys={["command"]}>K</Kbd>}
          classNames={{
            inputWrapper: `
              h-11 bg-foreground/[0.05] border border-foreground/[0.08]
              backdrop-blur-md shadow-none
              data-[hover=true]:bg-foreground/[0.08]
              group-data-[focus=true]:bg-foreground/[0.10]
              group-data-[focus=true]:border-primary/40
            `,
            input: "text-[13.5px] text-foreground placeholder:text-foreground/40",
          }}
        />
      </div>
    </div>
  );
}
