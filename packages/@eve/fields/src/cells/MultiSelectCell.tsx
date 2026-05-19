"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Input,
  Listbox,
  ListboxItem,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@heroui/react";
import { Plus, Search, X } from "lucide-react";

import { getChipClasses } from "../colors";
import type {
  FieldOption,
  HeroFieldSize,
  HeroFieldVariant,
} from "../types";
import { getValueMinHeight } from "./cellShared";

interface Props {
  value: string[] | undefined;
  onChange?: (v: string[]) => void;
  placeholder?: string;
  options?: FieldOption[];
  /** "select" = colored-dot chips (fixed taxonomy). "tags" = neutral chips. */
  appearance?: "select" | "tags";
  /** Allow typing free-form values to add (Enter to commit). */
  allowCustom?: boolean;
  size?: HeroFieldSize;
  variant?: HeroFieldVariant;
}

const CHIP_SIZES: Record<HeroFieldSize, string> = {
  sm: "text-[10px] px-1.5 py-0.5",
  md: "text-[11px] px-2 py-0.5",
  lg: "text-[12px] px-2 py-1",
};

/** Color-aware chip that mirrors SelectCell's StatusChip but supports removal. */
function ValueChip({
  option,
  size,
  onRemove,
}: {
  option: FieldOption;
  size: HeroFieldSize;
  onRemove?: () => void;
}) {
  const classes = getChipClasses(option.color);
  return (
    <span
      className={[
        "inline-flex items-center gap-1 rounded-full border font-medium tracking-tight",
        CHIP_SIZES[size],
        classes.bg,
        classes.text,
        classes.border,
      ].join(" ")}
    >
      <span className="truncate max-w-[140px]">{option.label}</span>
      {onRemove ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="hover:text-foreground transition-colors -mr-0.5 rounded-full"
          aria-label={`Remove ${option.label}`}
        >
          <X size={10} strokeWidth={2.5} />
        </button>
      ) : null}
    </span>
  );
}

/**
 * Multi-select / tags cell. Renders selected values as chips in the trigger.
 * Opening the popover shows a searchable listbox; with `allowCustom`, typing
 * and pressing Enter adds a free-form value. Each chip has an inline remove
 * button so users can prune without opening the picker.
 */
export function MultiSelectCell({
  value,
  onChange,
  placeholder = "—",
  options = [],
  appearance = "select",
  allowCustom = false,
  size = "md",
  variant = "inline",
}: Props) {
  const readOnly = !onChange;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = value ?? [];
  const selectedKeys = useMemo(() => new Set(selected), [selected]);

  const selectedOptions: FieldOption[] = useMemo(() => {
    return selected.map((v) => {
      const opt = options.find((o) => o.value === v);
      if (opt) return opt;
      return { value: v, label: v, color: "neutral" };
    });
  }, [selected, options]);

  const filteredOptions = useMemo(() => {
    if (!query.trim()) return options;
    const q = query.trim().toLowerCase();
    return options.filter(
      (o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q),
    );
  }, [options, query]);

  const queryMatchesOption = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return options.some(
      (o) => o.label.toLowerCase() === q || o.value.toLowerCase() === q,
    );
  }, [options, query]);

  const queryAlreadySelected = useMemo(() => {
    const q = query.trim().toLowerCase();
    return selected.some((v) => v.toLowerCase() === q);
  }, [selected, query]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  function toggle(v: string) {
    if (!onChange) return;
    const next = selected.includes(v)
      ? selected.filter((s) => s !== v)
      : [...selected, v];
    onChange(next);
  }

  function remove(v: string) {
    if (!onChange) return;
    onChange(selected.filter((s) => s !== v));
  }

  function addCustom() {
    if (!onChange) return;
    const next = query.trim();
    if (!next || queryAlreadySelected) return;
    onChange([...selected, next]);
    setQuery("");
  }

  // appearance variable retained for future styling differentiation
  void appearance;

  const minHeight = getValueMinHeight(size);

  const triggerContent = (
    <div
      className={[
        "flex flex-wrap items-center gap-1.5 w-full transition-colors",
        minHeight,
      ].join(" ")}
    >
      {selectedOptions.length === 0 ? (
        <span className="text-sm italic text-default-400">{placeholder}</span>
      ) : (
        selectedOptions.map((opt) => (
          <ValueChip
            key={opt.value}
            option={opt}
            size={size}
            onRemove={readOnly ? undefined : () => remove(opt.value)}
          />
        ))
      )}
      {!readOnly ? (
        <span
          className={[
            "inline-flex items-center gap-0.5 rounded-full border border-divider",
            "text-default-400 hover:text-foreground hover:border-default-400 transition-colors",
            CHIP_SIZES[size],
          ].join(" ")}
        >
          <Plus size={10} strokeWidth={2.5} />
          <span>Add</span>
        </span>
      ) : null}
    </div>
  );

  if (readOnly) {
    return triggerContent;
  }

  // variant retained for API parity with other cells
  void variant;

  return (
    <Popover
      isOpen={open}
      onOpenChange={setOpen}
      placement="bottom-start"
      offset={6}
      classNames={{
        content: "bg-content1 border border-divider rounded-xl p-0 min-w-[220px]",
      }}
    >
      <PopoverTrigger>
        <button type="button" className="w-full text-left cursor-pointer">
          {triggerContent}
        </button>
      </PopoverTrigger>
      <PopoverContent>
        <div className="flex flex-col">
          {(options.length > 0 || allowCustom) && (
            <div className="border-b border-divider p-1.5">
              <Input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && allowCustom && !queryMatchesOption) {
                    e.preventDefault();
                    addCustom();
                  }
                }}
                placeholder={allowCustom ? "Search or add…" : "Search…"}
                variant="flat"
                size="sm"
                startContent={<Search size={12} className="text-default-400" />}
                classNames={{
                  inputWrapper: "bg-default-100 shadow-none h-8 min-h-0",
                  input: "text-[13px] placeholder:text-default-400",
                }}
              />
            </div>
          )}
          <div className="max-h-[260px] overflow-y-auto p-1">
            {filteredOptions.length > 0 ? (
              <Listbox
                aria-label="Options"
                selectionMode="multiple"
                selectedKeys={selectedKeys}
                onAction={(key) => toggle(String(key))}
                classNames={{ base: "p-0", list: "gap-0.5" }}
              >
                {filteredOptions.map((opt) => {
                  const classes = getChipClasses(opt.color);
                  return (
                    <ListboxItem
                      key={opt.value}
                      startContent={
                        opt.color ? (
                          <span
                            className={`inline-block w-1.5 h-1.5 rounded-full ${classes.dot}`}
                          />
                        ) : null
                      }
                      description={opt.description}
                      classNames={{
                        base: "rounded-lg data-[hover=true]:bg-default-100",
                        title: "text-[13px] text-foreground",
                        description: "text-[11px] text-default-500",
                      }}
                    >
                      {opt.label}
                    </ListboxItem>
                  );
                })}
              </Listbox>
            ) : (
              <div className="px-3 py-2 text-[12px] text-default-400 italic">
                {query.trim()
                  ? allowCustom
                    ? `Press Enter to add "${query.trim()}"`
                    : "No matches"
                  : "No options"}
              </div>
            )}
            {allowCustom && query.trim() && !queryMatchesOption && !queryAlreadySelected ? (
              <button
                type="button"
                onClick={addCustom}
                className={[
                  "w-full flex items-center gap-2 px-2 py-1.5 mt-0.5 rounded-lg",
                  "text-[12px] text-default-500 hover:bg-default-100 transition-colors text-left",
                  "border-t border-divider",
                ].join(" ")}
              >
                <Plus size={11} className="text-default-400" />
                Add <span className="font-medium text-foreground">"{query.trim()}"</span>
              </button>
            ) : null}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
