"use client";

/**
 * `DockIcon` — single icon in the dock pill.
 *
 * Renders a 40×40 visionOS glass tile with a 20×20 Lucide glyph (or
 * remote SVG) over the brand-color gradient. Active state shows a 3px
 * tall accent pill 6px below the icon; running state shows a 3px dot
 * to its right (dim accent).
 *
 * The bounding box, the glyph size, and the centering math is shared
 * with `add-app-button.tsx` so every dock entry — pinned, core, or the
 * `+` terminator — feels identical.
 *
 * Right-click and long-press (500ms hold) open the same context menu.
 * The visible menu items are derived from `(isPinned, isRunning, isCompanionApp)`.
 *
 * No drop shadow. Depth comes from the dock's frosted pill behind.
 *
 * See: synap-team-docs/content/team/platform/eve-os-shell.mdx §5
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Home, Sparkles, Settings as SettingsIcon, MessageSquare, Brain,
  Paperclip, Wrench, Code2, Users, LayoutGrid, Box,
  Cpu, Rss, Pin, PinOff, ExternalLink, X, PanelRightOpen,
  type LucideIcon, type LucideProps,
} from "lucide-react";
import { Tooltip, Kbd } from "@heroui/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { brandColorFor } from "../lib/brand-colors";
import { createEmbeddedAppHref } from "../lib/app-launch-url";
import { useCompanionStore } from "../stores/companion-store";
import { usePinContext } from "./pin-context";
import type { DockApp } from "./use-dock-apps";

/** Right-click context-menu bounding box (max-height estimate for clamping). */
const MENU_W = 220;
const MENU_H = 200;

/** Long-press threshold and pointer-movement tolerance. */
const LONG_PRESS_MS = 500;
const LONG_PRESS_TOLERANCE_PX = 10;

/** App IDs that open as a side-docked Companion instead of a full route. */
const COMPANION_APP_IDS = new Set(["openwebui"]);

const isMac =
  typeof navigator !== "undefined" &&
  (navigator.platform.includes("Mac") || navigator.userAgent.includes("Mac"));

/**
 * Pinned apps have `path` set to `/apps/<id>?name=...&url=<iframeUrl>` (the
 * embedded-app route), but the companion needs the raw iframe URL to hand
 * to AppPane. Extract it from the route's `url` query param; fall back to
 * the path itself if it's already an absolute URL (external pin form).
 */
export function resolveCompanionUrl(path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  try {
    const u = new URL(path, "http://_local_");
    const embedded = u.searchParams.get("url");
    if (embedded) return embedded;
  } catch {
    /* fall through */
  }
  return path;
}

const GLYPHS: Record<string, LucideIcon> = {
  Home,
  Sparkles,
  Settings: SettingsIcon,
  MessageSquare,
  Brain,
  Paperclip,
  Wrench,
  Code2,
  Users,
  LayoutGrid,
  Cpu,
  Rss,
};

function GlyphFor({
  glyph,
  ...props
}: { glyph: string | null } & LucideProps) {
  if (!glyph) return <Box {...props} />;
  const Icon = GLYPHS[glyph] ?? Box;
  return <Icon {...props} />;
}

export interface DockIconProps {
  app: DockApp;
  active: boolean;
  iconUrl?: string;
  /**
   * When true, right-clicking the icon opens an "Unpin from dock" menu.
   * Core apps (Home / Agents / Settings) pass `false` because they
   * can't be removed from the dock.
   */
  unpinnable?: boolean;
}

export function DockIcon({ app, active, iconUrl, unpinnable = false }: DockIconProps) {
  const palette = brandColorFor(app.slug);
  const useRemote = !palette.glyph && iconUrl;
  const isExternal = app.path.startsWith("http");
  const href = isExternal
    ? createEmbeddedAppHref({
        id: app.id,
        name: app.name,
        url: app.path,
      })
    : app.path;

  // Right-click + long-press context menu.
  const router = useRouter();
  const { pin, unpin } = usePinContext();
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const isPinned = unpinnable; // unpinnable === pinned in the current API
  const isRunning = Boolean(app.running);
  const isCompanionApp = COMPANION_APP_IDS.has(app.id);
  // Menu is meaningful when the app can be pinned/unpinned or controlled (closed).
  const menuEnabled = isPinned || isRunning;

  const clampMenuPos = useCallback((x: number, y: number) => {
    return {
      x: Math.min(Math.max(x, 8), window.innerWidth - MENU_W - 8),
      y: Math.min(Math.max(y, 8), window.innerHeight - MENU_H - 8),
    };
  }, []);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (!menuEnabled) return;
      e.preventDefault();
      e.stopPropagation();
      setMenuPos(clampMenuPos(e.clientX, e.clientY));
    },
    [menuEnabled, clampMenuPos],
  );

  // Long-press: 500ms pointer hold opens the same menu.
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressOriginRef = useRef<{ x: number; y: number } | null>(null);

  const cancelLongPress = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressOriginRef.current = null;
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!menuEnabled) return;
      // Only primary button / single-touch.
      if (e.button !== 0 && e.pointerType === "mouse") return;
      const { clientX, clientY } = e;
      longPressOriginRef.current = { x: clientX, y: clientY };
      longPressTimerRef.current = setTimeout(() => {
        // If the right-click menu already opened, do nothing.
        setMenuPos((prev) => (prev ? prev : clampMenuPos(clientX, clientY)));
        longPressTimerRef.current = null;
      }, LONG_PRESS_MS);
    },
    [menuEnabled, clampMenuPos],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const origin = longPressOriginRef.current;
      if (!origin || !longPressTimerRef.current) return;
      const dx = Math.abs(e.clientX - origin.x);
      const dy = Math.abs(e.clientY - origin.y);
      if (dx > LONG_PRESS_TOLERANCE_PX || dy > LONG_PRESS_TOLERANCE_PX) {
        cancelLongPress();
      }
    },
    [cancelLongPress],
  );

  useEffect(() => () => cancelLongPress(), [cancelLongPress]);

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

  // Companion apps (e.g. AI chat / openwebui) toggle a side-docked
  // surface instead of navigating to the embedded-app route.
  const toggleCompanion = useCompanionStore((s) => s.toggle);
  const closeCompanion = useCompanionStore((s) => s.close);
  const companionOpen = useCompanionStore((s) => s.open);
  const companionKind = useCompanionStore((s) => s.kind);
  const companionPayload = useCompanionStore((s) => s.payload);
  const companionUrl = isCompanionApp ? resolveCompanionUrl(app.path) : "";
  const companionActive =
    isCompanionApp &&
    companionOpen &&
    companionKind === "ai-chat" &&
    companionPayload?.url === companionUrl;

  // Menu actions.
  const handleOpen = useCallback(() => {
    setMenuPos(null);
    if (isCompanionApp) {
      toggleCompanion("ai-chat", { url: companionUrl, title: app.name });
    } else {
      router.push(href);
    }
  }, [isCompanionApp, toggleCompanion, companionUrl, app.name, router, href]);

  const handleClose = useCallback(() => {
    setMenuPos(null);
    if (isCompanionApp) {
      closeCompanion();
    } else {
      router.push("/");
    }
  }, [isCompanionApp, closeCompanion, router]);

  const handlePin = useCallback(async () => {
    setMenuPos(null);
    await pin({
      id: app.id,
      slug: app.slug,
      name: app.name,
      url: app.path,
      iconUrl: app.iconUrl ?? null,
    });
  }, [pin, app.id, app.slug, app.name, app.path, app.iconUrl]);

  const handleUnpin = useCallback(async () => {
    setMenuPos(null);
    await unpin(app.id);
  }, [unpin, app.id]);

  // "Open in side companion" — host the app's iframe URL in the side panel.
  // companion-store only has `kind: "ai-chat"` today; we reuse it as the
  // generic embed slot until a dedicated kind exists. Skip when the app is
  // already a companion or has no resolvable URL.
  const sideCompanionUrl = !isCompanionApp ? resolveCompanionUrl(app.path) : "";
  const canOpenSideCompanion =
    !isCompanionApp &&
    Boolean(sideCompanionUrl) &&
    (sideCompanionUrl.startsWith("http://") || sideCompanionUrl.startsWith("https://"));

  const handleOpenInSideCompanion = useCallback(() => {
    setMenuPos(null);
    toggleCompanion("ai-chat", { url: sideCompanionUrl, title: app.name });
  }, [toggleCompanion, sideCompanionUrl, app.name]);

  const iconContent = useRemote ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={iconUrl}
      alt=""
      width={20}
      height={20}
      className="h-5 w-5 object-contain"
      referrerPolicy="no-referrer"
    />
  ) : (
    <GlyphFor
      glyph={palette.glyph}
      className="h-5 w-5 text-white"
      strokeWidth={2}
      aria-hidden
    />
  );

  const sharedClassName = `
    glass-icon
    flex h-10 w-10 items-center justify-center
    transition-transform duration-200 ease-out
    hover:scale-[1.10] active:scale-[0.95] active:duration-[80ms]
    focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50
  `;

  const showActive = isCompanionApp ? companionActive : active;
  const showRunningDot = isRunning && !companionActive;

  // Tooltip content — AI chat companion app shows its hotkey hint.
  const tooltipContent = isCompanionApp ? (
    <span className="flex items-center gap-2">
      <span>{app.name}</span>
      <Kbd keys={isMac ? ["command", "shift"] : ["ctrl", "shift"]}>Space</Kbd>
    </span>
  ) : (
    app.name
  );

  // Determine menu groups (state-matrix; see component docstring).
  const showOpenItem = isPinned && !isRunning;
  const showOpenInSideCompanionItem =
    isPinned && !isRunning && canOpenSideCompanion;
  const showCloseItem = isRunning;
  const showPinItem = !isPinned && isRunning;
  const showUnpinItem = isPinned;
  const actionGroupHasItems =
    showOpenItem || showOpenInSideCompanionItem || showCloseItem || showPinItem;
  const managementGroupHasItems = showUnpinItem;
  const showSeparator = actionGroupHasItems && managementGroupHasItems;

  return (
    <div
      className="relative flex h-10 w-10 shrink-0 items-center justify-center"
      onContextMenu={handleContextMenu}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={cancelLongPress}
      onPointerLeave={cancelLongPress}
      onPointerCancel={cancelLongPress}
    >
      <Tooltip
        content={tooltipContent}
        placement="top"
        delay={400}
        offset={8}
        isDisabled={menuPos !== null}
      >
        {isCompanionApp ? (
          <button
            type="button"
            aria-label={`Open ${app.name}`}
            aria-pressed={companionActive}
            className={sharedClassName}
            style={{ background: palette.bg }}
            onClick={() =>
              toggleCompanion("ai-chat", {
                url: companionUrl,
                title: app.name,
              })
            }
          >
            {iconContent}
          </button>
        ) : (
          <Link
            href={href}
            aria-label={`Open ${app.name}`}
            className={sharedClassName}
            style={{ background: palette.bg }}
          >
            {iconContent}
          </Link>
        )}
      </Tooltip>

      {/* Active indicator pill — 3px tall x 10px wide, ~6px below the icon. */}
      {showActive && (
        <span
          className="absolute -bottom-1.5 left-1/2 h-[3px] w-2.5 -translate-x-1/2 rounded-full"
          style={{ background: palette.accent }}
          aria-hidden
        />
      )}

      {/* Running indicator dot — 3px circle right of the active pill. */}
      {showRunningDot && (
        <span
          className="absolute -bottom-1.5 h-[3px] w-[3px] rounded-full"
          style={{
            left: showActive
              ? "calc(50% + 9px)" // right of the 10px active pill (centered at 50%, half=5px) + 4px gap
              : "50%",
            transform: showActive ? "none" : "translateX(-50%)",
            background: palette.accent,
            opacity: 0.55,
          }}
          aria-hidden
        />
      )}

      {/* Right-click / long-press context menu. */}
      {menuPos && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Dock icon options"
          className="
            fixed z-50 min-w-[220px] overflow-hidden
            rounded-xl border border-foreground/10
            bg-background/85 backdrop-blur-2xl
            py-1
          "
          style={{ left: menuPos.x, top: menuPos.y }}
        >
          {showOpenItem && (
            <button
              role="menuitem"
              type="button"
              className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-[13px] text-foreground hover:bg-foreground/[0.07] transition-colors duration-100 cursor-default select-none"
              onMouseDown={(e) => e.preventDefault()}
              onClick={handleOpen}
            >
              <ExternalLink className="h-3.5 w-3.5 shrink-0 text-foreground/55" strokeWidth={2} aria-hidden />
              Open
            </button>
          )}
          {showOpenInSideCompanionItem && (
            <button
              role="menuitem"
              type="button"
              className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-[13px] text-foreground hover:bg-foreground/[0.07] transition-colors duration-100 cursor-default select-none"
              onMouseDown={(e) => e.preventDefault()}
              onClick={handleOpenInSideCompanion}
            >
              <PanelRightOpen className="h-3.5 w-3.5 shrink-0 text-foreground/55" strokeWidth={2} aria-hidden />
              Open in side companion
            </button>
          )}
          {showCloseItem && (
            <button
              role="menuitem"
              type="button"
              className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-[13px] text-foreground hover:bg-foreground/[0.07] transition-colors duration-100 cursor-default select-none"
              onMouseDown={(e) => e.preventDefault()}
              onClick={handleClose}
            >
              <X className="h-3.5 w-3.5 shrink-0 text-foreground/55" strokeWidth={2} aria-hidden />
              Close
            </button>
          )}
          {showPinItem && (
            <button
              role="menuitem"
              type="button"
              className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-[13px] text-foreground hover:bg-foreground/[0.07] transition-colors duration-100 cursor-default select-none"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => void handlePin()}
            >
              <Pin className="h-3.5 w-3.5 shrink-0 text-foreground/55" strokeWidth={2} aria-hidden />
              Pin to dock
            </button>
          )}
          {showSeparator && (
            <span aria-hidden className="my-0.5 block h-px bg-foreground/[0.06]" />
          )}
          {showUnpinItem && (
            <button
              role="menuitem"
              type="button"
              className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-[13px] text-foreground hover:bg-foreground/[0.07] transition-colors duration-100 cursor-default select-none"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => void handleUnpin()}
            >
              <PinOff className="h-3.5 w-3.5 shrink-0 text-foreground/55" strokeWidth={2} aria-hidden />
              Unpin from dock
            </button>
          )}
        </div>
      )}
    </div>
  );
}
