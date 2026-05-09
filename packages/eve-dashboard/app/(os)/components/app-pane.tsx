"use client";

/**
 * `AppPane` — iFrame host for embedded Eve OS apps.
 *
 * ## postMessage auth handshake
 *
 * Eve apps embedded in an iFrame cannot read the parent's localStorage
 * (same-origin policy) and cross-origin iFrame cookies are blocked by
 * SameSite=Lax. The pane bridges this gap with a two-phase handshake
 * that mirrors the Synap Hub pattern (`HubShell.tsx`):
 *
 *   Phase 1 — proactive push (on iframe load):
 *     Eve  →  app : { type: "synap:auth", session: SharedSession }
 *
 *   Phase 2 — on-demand pull (if the app misses phase 1):
 *     app  →  Eve : { type: "synap:ready" }
 *     Eve  →  app : { type: "synap:auth", session: SharedSession }
 *
 * Security invariants:
 *   - Session tokens are NEVER posted to `"*"`. The `targetOrigin`
 *     is always the exact origin derived from the app URL.
 *   - Incoming `synap:ready` messages are rejected when `e.origin` is
 *     not in the `isAllowedEmbedOrigin` allowlist (`@eve/dna`).
 *   - Unrecognised message types are silently ignored.
 *
 * Child-side receiver lives in `@synap-core/auth` (or per-app shims).
 * See: synap-team-docs/content/team/platform/eve-os-shell.mdx — iFrame auth
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Spinner } from "@heroui/react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { getSharedSession } from "@/lib/synap-auth";
import { isAllowedEmbedOrigin } from "@eve/dna";

type PaneStatus = "probing" | "loading" | "ready" | "unreachable";

export interface AppPaneProps {
  /** Stable app identifier — used as the iframe `title` and in error copy. */
  appId: string;
  /** Full URL to load in the iframe. */
  url: string;
  /**
   * Visibility toggle. When false the pane hides but stays mounted so
   * the embedded app keeps its state (keep-alive pattern from HubShell).
   */
  isActive?: boolean;
  className?: string;
}

export function AppPane({ appId, url, isActive = true, className }: AppPaneProps) {
  const [status, setStatus] = useState<PaneStatus>("probing");
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Derive the exact origin once so we never use "*" when posting the session.
  const targetOrigin = useMemo(() => {
    try { return new URL(url).origin; } catch { return null; }
  }, [url]);

  // Push the session to a target window using the exact origin.
  // No-op when there is no active session or the origin is unknown.
  const pushSession = useCallback(
    (target: Window) => {
      if (!targetOrigin) return;
      const session = getSharedSession();
      if (!session) return;
      target.postMessage({ type: "synap:auth", session }, targetOrigin);
    },
    [targetOrigin],
  );

  // Probe reachability with a no-cors HEAD before loading the iframe,
  // so we can show a friendly "not running" state instead of a blank frame.
  const probe = useCallback(async (target: string) => {
    setStatus("probing");
    try {
      await fetch(target, { method: "HEAD", mode: "no-cors", cache: "no-store" });
      setStatus("loading");
    } catch {
      setStatus("unreachable");
    }
  }, []);

  useEffect(() => { void probe(url); }, [url, probe]);

  // Phase 1 — proactive push once the iframe reports it has loaded.
  const handleLoad = useCallback(() => {
    if (status !== "loading") return;
    setStatus("ready");
    const win = iframeRef.current?.contentWindow;
    if (win) pushSession(win);
  }, [status, pushSession]);

  // Phase 2 — respond to synap:ready pull requests from the child.
  // Always re-register so pushSession closure stays fresh.
  useEffect(() => {
    function handler(e: MessageEvent) {
      if (e.data?.type !== "synap:ready") return;
      if (!e.source || !isAllowedEmbedOrigin(e.origin)) return;
      pushSession(e.source as Window);
    }
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [pushSession]);

  return (
    <div className={`relative w-full h-full overflow-hidden ${className ?? ""}`}>
      {/* Loading overlay — shown while probing or waiting for iframe load */}
      {(status === "probing" || status === "loading") && isActive && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background">
          <div className="flex flex-col items-center gap-3">
            <Spinner size="sm" color="primary" />
            <p className="text-xs text-foreground/40">
              {status === "probing" ? "Connecting…" : "Loading…"}
            </p>
          </div>
        </div>
      )}

      {/* Unreachable state — app service is not running */}
      {status === "unreachable" && isActive && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background">
          <div className="flex flex-col items-center gap-5 text-center max-w-sm px-6">
            <AlertCircle size={28} className="text-foreground/20" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground capitalize">
                {appId} is not running
              </p>
              <p className="text-xs text-foreground/40">
                Could not reach{" "}
                <code className="font-mono text-foreground/60">{url}</code>
              </p>
            </div>
            <button
              onClick={() => void probe(url)}
              className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 transition-colors"
            >
              <RefreshCw size={12} />
              Retry
            </button>
          </div>
        </div>
      )}

      <iframe
        ref={iframeRef}
        src={status === "loading" || status === "ready" ? url : "about:blank"}
        title={appId}
        className="w-full h-full border-0"
        onLoad={handleLoad}
        allow="clipboard-read; clipboard-write"
        sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"
      />
    </div>
  );
}
