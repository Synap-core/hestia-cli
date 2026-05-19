"use client";
import { useMemo, useRef, useState } from "react";
import {
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Spinner,
} from "@heroui/react";
import { Plus, Search, X } from "lucide-react";

import type {
  EntityRef,
  EntitySearchFn,
  HeroFieldSize,
  HeroFieldVariant,
} from "../types";
import { getValueMinHeight } from "./cellShared";
import { EntityAvatar, useEntitySearch } from "./entityShared";

interface Props {
  value: EntityRef[] | undefined;
  onChange?: (v: EntityRef[]) => void;
  placeholder?: string;
  searchEntities: EntitySearchFn;
  searchPlaceholder?: string;
  size?: HeroFieldSize;
  variant?: HeroFieldVariant;
}

const CHIP_SIZES: Record<HeroFieldSize, string> = {
  sm: "text-[10px] px-1 py-0.5",
  md: "text-[11px] px-1.5 py-0.5",
  lg: "text-[12px] px-2 py-1",
};

function EntityChip({
  entity,
  size,
  onRemove,
}: {
  entity: EntityRef;
  size: HeroFieldSize;
  onRemove?: () => void;
}) {
  return (
    <span
      className={[
        "inline-flex items-center gap-1 rounded-full",
        "bg-content1 border border-divider/60 text-foreground/80",
        CHIP_SIZES[size],
      ].join(" ")}
    >
      <EntityAvatar entity={entity} size="sm" />
      <span className="truncate max-w-[140px]">{entity.name}</span>
      {onRemove ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="text-foreground/40 hover:text-foreground/80 transition-colors -mr-0.5"
          aria-label={`Remove ${entity.name}`}
        >
          <X size={10} strokeWidth={2.5} />
        </button>
      ) : null}
    </span>
  );
}

/**
 * Multi-entity link cell. Each linked entity is a chip with avatar + name + ×.
 * "+ Add" opens a Popover with search; selected entities are highlighted and
 * picking again toggles them off.
 */
export function MultiEntityCell({
  value,
  onChange,
  placeholder = "—",
  searchEntities,
  searchPlaceholder = "Search…",
  size = "md",
  variant: _variant = "inline",
}: Props) {
  const readOnly = !onChange;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = value ?? [];
  const selectedIds = useMemo(() => new Set(selected.map((e) => e.id)), [selected]);

  const { results, loading, error } = useEntitySearch(
    searchEntities,
    query,
    open,
  );

  const minHeight = getValueMinHeight(size);

  function toggle(entity: EntityRef) {
    if (!onChange) return;
    if (selectedIds.has(entity.id)) {
      onChange(selected.filter((e) => e.id !== entity.id));
    } else {
      onChange([...selected, entity]);
    }
  }

  function remove(id: string) {
    if (!onChange) return;
    onChange(selected.filter((e) => e.id !== id));
  }

  const triggerContent = (
    <div
      className={[
        "flex flex-wrap items-center gap-1.5 w-full transition-colors",
        minHeight,
      ].join(" ")}
    >
      {selected.length === 0 ? (
        <span className="text-sm italic text-foreground/35">{placeholder}</span>
      ) : (
        selected.map((entity) => (
          <EntityChip
            key={entity.id}
            entity={entity}
            size={size}
            onRemove={readOnly ? undefined : () => remove(entity.id)}
          />
        ))
      )}
      {!readOnly ? (
        <span
          className={[
            "inline-flex items-center gap-0.5 rounded-full border border-divider/60",
            "text-foreground/40 hover:text-foreground/70 hover:border-foreground/30 transition-colors",
            CHIP_SIZES[size],
          ].join(" ")}
        >
          <Plus size={10} strokeWidth={2.5} />
          <span>Add</span>
        </span>
      ) : null}
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
          "bg-background/95 backdrop-blur-xl border border-divider rounded-xl shadow-lg p-0 min-w-[280px]",
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
                loading ? (
                  <Spinner size="sm" classNames={{ wrapper: "w-3 h-3" }} />
                ) : null
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
                {results.map((entity) => {
                  const isSelected = selectedIds.has(entity.id);
                  return (
                    <li key={entity.id}>
                      <button
                        type="button"
                        onClick={() => toggle(entity)}
                        className={[
                          "w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left",
                          "hover:bg-content1 transition-colors",
                          isSelected ? "bg-content1/60" : "",
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
                        {isSelected ? (
                          <span className="text-[10px] text-primary shrink-0 font-medium">
                            ✓
                          </span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
