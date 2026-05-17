"use client";

/**
 * use-companion-hotkeys — global Cmd+Shift+Space (Mac) / Ctrl+Shift+Space (others)
 * that toggles the AI chat companion. Mount once at the OS shell layout level.
 *
 * Uses `e.code === "Space"` (not `e.key`) for layout-independence, and
 * Cmd+Shift+Space to avoid colliding with the browser's Cmd+L address-bar
 * shortcut the previous binding stole.
 *
 * The companion now hosts Eve's native chat placeholder — no OpenWebUI
 * URL resolution needed. Pressing the hotkey simply toggles the companion.
 */

import { useEffect } from "react";
import { useCompanionStore } from "../stores/companion-store";

const isMac =
  typeof navigator !== "undefined" &&
  (navigator.platform.includes("Mac") || navigator.userAgent.includes("Mac"));

export function useCompanionHotkeys() {
  useEffect(() => {
    console.info("[companion-hotkeys] mounted — press ⌘⇧Space (Mac) or Ctrl+Shift+Space");

    function onKeyDown(e: KeyboardEvent) {
      const isMacCombo = isMac && e.metaKey && e.shiftKey && !e.ctrlKey && !e.altKey && e.code === "Space";
      const isOtherCombo = !isMac && e.ctrlKey && e.shiftKey && !e.metaKey && !e.altKey && e.code === "Space";
      if (!isMacCombo && !isOtherCombo) return;

      // Don't steal focus from text inputs.
      const active = document.activeElement;
      if (
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        active?.getAttribute("contenteditable") === "true"
      ) {
        return;
      }

      e.preventDefault();
      useCompanionStore.getState().toggle("ai-chat", { title: "Chat" });
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
