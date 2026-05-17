"use client";

/**
 * `AddAppButton` — the dock's `+` terminator.
 *
 * Same 40×40 bounding box as a real DockIcon. No glass recipe (we want
 * this to feel like empty real estate, not a launcher tile) — just a
 * frosted pill with a soft inner stroke and a centered `+` glyph.
 *
 * Click opens an inline `DockPinPopover` anchored above the button so
 * users can pin/unpin apps without leaving the current pane. The full
 * marketplace is still reachable via the popover's footer link.
 */

import { Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { DockPinPopover } from "./dock-pin-popover";

export function AddAppButton() {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Click-outside closes. Mousedown beats the dock's stop-propagation race.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        aria-label="Pin apps to dock"
        aria-expanded={open}
        title="Pin apps"
        onClick={() => setOpen((o) => !o)}
        className="
          group inline-flex h-10 w-10 shrink-0 items-center justify-center
          rounded-app-icon
          bg-foreground/[0.06]
          ring-1 ring-inset ring-foreground/15
          text-foreground/55
          transition-all duration-200 ease-out
          hover:bg-foreground/[0.10] hover:text-foreground hover:scale-[1.10]
          active:scale-[0.95]
          focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50
        "
      >
        <Plus className="h-5 w-5" strokeWidth={2.2} aria-hidden />
      </button>

      {/* Anchor: bottom-right of button, popover floats above. */}
      <div className="absolute bottom-full right-0 z-30 mb-3">
        <DockPinPopover open={open} onOpenChange={setOpen} />
      </div>
    </div>
  );
}
