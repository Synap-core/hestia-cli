"use client";

/**
 * use-companion-hotkeys — global Cmd+Shift+Space (Mac) / Ctrl+Shift+Space (others)
 * that toggles the AI chat companion. Mount once at the OS shell layout level.
 *
 * Uses `e.code === "Space"` (not `e.key`) for layout-independence, and
 * Cmd+Shift+Space to avoid colliding with the browser's Cmd+L address-bar
 * shortcut that the previous binding stole.
 *
 * Resolution order for the OpenWebUI iframe URL:
 *   1. pinnedApps (slug === "openwebui") — synchronous, no network cost.
 *   2. /api/components — fetched once on first miss, then cached in a ref.
 *
 * The resolved URL is cached in a ref so repeated presses are instant.
 * The cache is invalidated when pinnedApps changes (user pins/unpins).
 */

import { useEffect, useRef } from "react";
import { usePinContext } from "../components/pin-context";
import { useCompanionStore } from "../stores/companion-store";
import { resolveCompanionUrl } from "../components/dock-icon";

const isMac =
  typeof navigator !== "undefined" &&
  (navigator.platform.includes("Mac") || navigator.userAgent.includes("Mac"));

interface EveComponent {
  slug: string;
  url?: string;
  path?: string;
  [key: string]: unknown;
}

export function useCompanionHotkeys() {
  const { pinnedApps } = usePinContext();
  const resolvedUrlRef = useRef<string | null>(null);
  // Track the pinnedApps reference so we can bust the cache on change.
  const pinnedAppsRef = useRef(pinnedApps);

  // Bust URL cache when pinnedApps changes so a fresh pin/unpin is reflected.
  useEffect(() => {
    if (pinnedAppsRef.current !== pinnedApps) {
      pinnedAppsRef.current = pinnedApps;
      resolvedUrlRef.current = null;
    }
  }, [pinnedApps]);

  useEffect(() => {
    // Mount log so devtools can confirm the bridge is loaded.
    console.info("[companion-hotkeys] mounted — press ⌘⇧Space (Mac) or Ctrl+Shift+Space");

    async function resolveUrl(): Promise<string | null> {
      // 1. Check cached value.
      if (resolvedUrlRef.current !== null) return resolvedUrlRef.current;

      // 2. Try pinnedApps first (synchronous, no network).
      const pinned = pinnedAppsRef.current.find((a) => a.slug === "openwebui" || a.id === "openwebui");
      if (pinned) {
        const url = resolveCompanionUrl(pinned.url);
        resolvedUrlRef.current = url;
        return url;
      }

      // 3. Fallback: fetch /api/components (only on first miss).
      try {
        const res = await fetch("/api/components", { credentials: "include", cache: "no-store" });
        if (!res.ok) return null;
        const components: EveComponent[] = await res.json();
        const owui = components.find((c) => c.slug === "openwebui");
        if (!owui) return null;
        const raw = owui.url ?? owui.path ?? "";
        const url = resolveCompanionUrl(raw as string);
        resolvedUrlRef.current = url;
        return url;
      } catch {
        return null;
      }
    }

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

      // Intercept before the browser/OS routes the combo elsewhere.
      e.preventDefault();

      resolveUrl().then((url) => {
        if (!url) {
          console.warn("[companion-hotkeys] OpenWebUI not found — install or pin it to use Cmd+Shift+Space.");
          return;
        }
        useCompanionStore.getState().toggle("ai-chat", { url, title: "AI Chat" });
      });
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []); // stable — resolveUrl reads refs, pinnedApps bust handled above
}
