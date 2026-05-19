"use client";
import { useMemo, useState } from "react";
import {
  Button,
  Calendar,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@heroui/react";
import {
  type CalendarDate,
  parseDate,
  today,
  getLocalTimeZone,
} from "@internationalized/date";
import { X } from "lucide-react";

import type { HeroFieldSize, HeroFieldVariant } from "../types";
import {
  getValueColor,
  getValueMinHeight,
  getValueTypography,
} from "./cellShared";

interface Props {
  /** ISO date string (YYYY-MM-DD) or full ISO timestamp. */
  value: string | undefined;
  onChange?: (v: string | undefined) => void;
  placeholder?: string;
  size?: HeroFieldSize;
  variant?: HeroFieldVariant;
  align?: "left" | "right";
  /** Show relative phrasing ("Today", "in 3 days") for nearby dates. */
  relative?: boolean;
  locale?: string;
}

function toDateValue(iso: string | undefined): CalendarDate | null {
  if (!iso) return null;
  try {
    return parseDate(iso.slice(0, 10));
  } catch {
    return null;
  }
}

function formatDate(
  iso: string,
  relative: boolean,
  locale: string,
): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;

  if (relative) {
    const todayDate = today(getLocalTimeZone());
    const dv = toDateValue(iso);
    if (dv) {
      const todayMs = todayDate.toDate(getLocalTimeZone()).getTime();
      const valueMs = dv.toDate(getLocalTimeZone()).getTime();
      const diffDays = Math.round((valueMs - todayMs) / 86_400_000);
      if (diffDays === 0) return "Today";
      if (diffDays === 1) return "Tomorrow";
      if (diffDays === -1) return "Yesterday";
      if (diffDays > 0 && diffDays <= 6) return `In ${diffDays} days`;
      if (diffDays < 0 && diffDays >= -6) return `${-diffDays} days ago`;
    }
  }

  const sameYear = date.getFullYear() === new Date().getFullYear();
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
  }).format(date);
}

/**
 * Date cell — Popover-anchored HeroUI Calendar. The trigger button is styled
 * to look identical to the display text, so opening the calendar feels like
 * a natural extension of the value, not a separate form widget.
 */
export function DateCell({
  value,
  onChange,
  placeholder = "—",
  size = "md",
  variant = "inline",
  align = "left",
  relative = true,
  locale,
}: Props) {
  const readOnly = !onChange;
  const [open, setOpen] = useState(false);
  const resolvedLocale =
    locale ??
    (typeof navigator !== "undefined" ? navigator.language : "en-US");

  const calendarValue = useMemo(() => toDateValue(value), [value]);

  const displayText = value
    ? formatDate(value, relative, resolvedLocale)
    : placeholder;

  const typography = getValueTypography(size, variant);
  const minHeight = getValueMinHeight(size);

  const triggerClasses = [
    "block w-full bg-transparent outline-none transition-colors truncate",
    typography,
    minHeight,
    align === "right" ? "text-right" : "text-left",
    getValueColor(Boolean(value)),
    !readOnly ? "cursor-pointer" : "cursor-default",
  ].join(" ");

  if (readOnly) {
    return (
      <div className={triggerClasses}>
        <span className="truncate">{displayText}</span>
      </div>
    );
  }

  return (
    <Popover
      isOpen={open}
      onOpenChange={setOpen}
      placement="bottom-start"
      offset={6}
      classNames={{
        content: "bg-background border border-divider shadow-lg rounded-xl p-0",
      }}
    >
      <PopoverTrigger>
        <button type="button" className={triggerClasses}>
          <span className="truncate">{displayText}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent>
        <div className="flex flex-col">
          <Calendar
            aria-label="Pick a date"
            // HeroUI's Calendar bundles a pinned copy of @internationalized/date
            // whose branded private fields don't unify with the one we resolve
            // at the workspace root (same major, different pnpm path). Runtime
            // is interchangeable; the `as never` escape sidesteps the brand
            // mismatch while keeping CalendarDate as the working type below.
            value={calendarValue as never}
            onChange={((next: CalendarDate | null) => {
              onChange?.(next ? next.toString() : undefined);
              setOpen(false);
            }) as never}
            classNames={{
              base: "shadow-none border-none bg-transparent",
            }}
          />
          {value ? (
            <div className="flex justify-end gap-1 border-t border-divider px-2 py-1.5">
              <Button
                size="sm"
                variant="light"
                startContent={<X size={12} />}
                onPress={() => {
                  onChange?.(undefined);
                  setOpen(false);
                }}
                className="text-foreground/60 hover:text-foreground"
              >
                Clear
              </Button>
            </div>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
