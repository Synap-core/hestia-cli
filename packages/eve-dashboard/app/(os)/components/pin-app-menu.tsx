"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Pin, PinOff } from "lucide-react";
import { usePinContext, type PinnedApp } from "./pin-context";

const MENU_W = 190;
const MENU_H = 48;

export function PinAppMenu({
  app,
  children,
}: {
  app: PinnedApp;
  children: React.ReactNode;
}) {
  const { pinnedIds, pin, unpin } = usePinContext();
  const isPinned = pinnedIds.has(app.id);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const x = Math.min(e.clientX, window.innerWidth - MENU_W - 8);
    const y = Math.min(e.clientY, window.innerHeight - MENU_H - 8);
    setMenuPos({ x, y });
  }, []);

  useEffect(() => {
    if (!menuPos) return;
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuPos(null);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuPos(null);
    }
    function onScroll() {
      setMenuPos(null);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, { capture: true });
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, { capture: true });
    };
  }, [menuPos]);

  async function handleToggle() {
    setMenuPos(null);
    if (isPinned) {
      await unpin(app.id);
    } else {
      await pin(app);
    }
  }

  return (
    <div onContextMenu={handleContextMenu} className="contents">
      {children}
      {menuPos && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="App options"
          className="
            fixed z-50 min-w-[190px] overflow-hidden
            rounded-xl border border-white/10
            bg-background/85 backdrop-blur-2xl
            shadow-[0_8px_32px_rgba(0,0,0,0.30)]
            py-1
          "
          style={{ left: menuPos.x, top: menuPos.y }}
        >
          <button
            role="menuitem"
            type="button"
            className="
              flex w-full items-center gap-2.5 px-3.5 py-2.5
              text-[13px] text-foreground
              hover:bg-foreground/[0.07]
              transition-colors duration-100
              cursor-default select-none
            "
            onMouseDown={(e) => e.preventDefault()}
            onClick={handleToggle}
          >
            {isPinned ? (
              <PinOff
                className="h-3.5 w-3.5 shrink-0 text-foreground/55"
                strokeWidth={2}
                aria-hidden
              />
            ) : (
              <Pin
                className="h-3.5 w-3.5 shrink-0 text-foreground/55"
                strokeWidth={2}
                aria-hidden
              />
            )}
            {isPinned ? "Unpin from dock" : "Pin to dock"}
          </button>
        </div>
      )}
    </div>
  );
}
