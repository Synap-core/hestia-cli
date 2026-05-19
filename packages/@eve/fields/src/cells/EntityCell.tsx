"use client";
import { useRef, useState } from "react";
import {
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Spinner,
} from "@heroui/react";
import { Search, X } from "lucide-react";

import type {
  EntityRef,
  EntitySearchFn,
  HeroFieldSize,
  HeroFieldVariant,
} from "../types";
import { getValueMinHeight, getValueTypography } from "./cellShared";
import { EntityAvatar, useEntitySearch } from "./entityShared";

interface Props {
  value: EntityRef | undefined;
  onChange?: (v: EntityRef | undefined) => void;
  placeholder?: string;
  searchEntities: EntitySearchFn;
  /** Hint shown above the search bar (e.g. "Search contacts"). */
  searchPlaceholder?: string;
  size?: HeroFieldSize;
  variant?: HeroFieldVariant;
}

const NAME_TYPOGRAPHY: Record<HeroFieldSize, string> = {
  sm: "text-[12px]",
  md: "text-[13px]",
  lg: "text-sm",
};

/**
 * Single linked-entity cell. Display = avatar + name with × to clear.
 * Trigger = the entire row, opens a Popover with a search-as-you-type list.
 */
export function EntityCell({
  value,
  onChange,
  placeholder = "—",
  searchEntities,
  searchPlaceholder = "Search…",
  size = "md",
  variant = "inline",
}: Props) {
  const readOnly = !onChange;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const { results, loading, error } = useEntitySearch(
    searchEntities,
    query,
    open,
  );

  const minHeight = getValueMinHeight(size);
  const typography = getValueTypography(size, variant);

  function pick(entity: EntityRef) {
    onChange?.(entity);
    setOpen(false);
    setQuery("");
  }

  function clear(e: React.MouseEvent) {
    e.stopPropagation();
    onChange?.(undefined);
  }

  const triggerContent = value ? (
    <div className={["flex items-center gap-2 w-full", minHeight].join(" ")}>
      <EntityAvatar entity={value} size={size} />
      <div className="flex-1 min-w-0">
        <div
          className={[
            NAME_TYPOGRAPHY[size],
            "truncate text-foreground/85",
          ].join(" ")}
        >
          {value.name}
        </div>
        {value.subtitle ? (
          <div className="text-[10px] text-foreground/40 truncate">
            {value.subtitle}
          </div>
        ) : null}
      </div>
      {!readOnly ? (
        <button
          type="button"
          onClick={clear}
          aria-label="Remove"
          className="text-foreground/30 hover:text-foreground/70 transition-colors shrink-0 p-0.5"
        >
          <X size={12} strokeWidth={2.5} />
        </button>
      ) : null}
    </div>
  ) : (
    <div
      className={[
        "flex items-center w-full transition-colors",
        typography,
        minHeight,
        "italic text-foreground/35",
      ].join(" ")}
    >
      {placeholder}
    </div>
  );

  if (readOnly) return triggerContent;

  return (
    <Popover
      isOpen={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setTimeout(() => inputRef.current?.focus(), 50);
        else setQuery("");
      }}
      placement="bottom-start"
      offset={6}
      classNames={{
        content:
          "bg-background/95 backdrop-blur-xl border border-divider rounded-xl shadow-lg p-0 min-w-[260px]",
      }}
    >
      <PopoverTrigger>
        <button type="button" className="w-full text-left cursor-pointer">
          {triggerContent}
        </button>
      </PopoverTrigger>
      <PopoverContent>
        <div className="flex flex-col">
          <div className="border-b border-divider/60 p-1.5">
            <Input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              variant="flat"
              size="sm"
              startContent={<Search size={12} className="text-foreground/40" />}
              endContent={
                loading ? <Spinner size="sm" classNames={{ wrapper: "w-3 h-3" }} /> : null
              }
              classNames={{
                inputWrapper: "bg-content1/50 shadow-none h-8 min-h-0",
                input: "text-[13px] placeholder:text-foreground/35",
              }}
            />
          </div>
          <div className="max-h-[280px] overflow-y-auto p-1">
            {error ? (
              <div className="px-3 py-2 text-[12px] text-rose-400 italic">
                {error}
              </div>
            ) : results.length === 0 && !loading ? (
              <div className="px-3 py-2 text-[12px] text-foreground/40 italic">
                {query.trim() ? "No matches" : "Start typing to search…"}
              </div>
            ) : (
              <ul className="flex flex-col gap-0.5">
                {results.map((entity) => (
                  <li key={entity.id}>
                    <button
                      type="button"
                      onClick={() => pick(entity)}
                      className={[
                        "w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left",
                        "hover:bg-content1 transition-colors",
                        value?.id === entity.id ? "bg-content1/60" : "",
                      ].join(" ")}
                    >
                      <EntityAvatar entity={entity} size="md" />
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] text-foreground/85 truncate">
                          {entity.name}
                        </div>
                        {entity.subtitle ? (
                          <div className="text-[11px] text-foreground/45 truncate">
                            {entity.subtitle}
                          </div>
                        ) : null}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
