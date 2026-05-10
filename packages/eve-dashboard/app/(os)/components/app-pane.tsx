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
import { getAllPodSessions, getSharedSession, type SharedSession } from "@/lib/synap-auth";
import { createAllowedEmbedOriginChecker } from "@eve/dna/browser";
import { useOverlayStore, type SystemOverlayKind } from "../stores/overlay-store";

// Mirror of @synap-core/overlay-protocol — replace with import once published.
type AppTrustLevel = "trusted" | "installed" | "generated";
const TRUSTED_OVERLAY_KINDS: Record<AppTrustLevel, SystemOverlayKind[]> = {
  trusted:   ["command", "switcher", "agent", "vault", "permission", "cell"],
  installed: ["command", "agent", "vault", "permission"],
  generated: ["command", "agent"],
};

type PaneStatus = "loading" | "ready" | "unreachable";

// Returns the best available session for posting to an embedded app.
// Prefers the CP session; falls back to the first active pod session so
// pod-direct (Mode B) users aren't locked out of auto-auth.
function resolveSessionForEmbed(): SharedSession | null {
  const cp = getSharedSession();
  if (cp) return cp;
  const pods = getAllPodSessions();
  const first = Object.values(pods).find((s) => s?.sessionToken);
  if (!first) return null;
  return {
    podUrl: first.podUrl,
    sessionToken: first.sessionToken,
    workspaceId: "",
    userId: first.userId ?? "",
    userName: first.userEmail ?? "",
  };
}

export interface AppPaneProps {
  /** Stable app identifier — used as the iframe `title` and in error copy. */
  appId: string;
  /** Full URL to load in the iframe. */
  url: string;
  /** Whether this pane may receive the current pod session. */
  sendAuth?: boolean;
  /**
   * Visibility toggle. When false the pane hides but stays mounted so
   * the embedded app keeps its state (keep-alive pattern from HubShell).
   */
  isActive?: boolean;
  className?: string;
  /**
   * Trust level for overlay bridge requests. Determines which overlay
   * kinds this iframe may request. Defaults to "installed".
   * srcdoc iframes (origin "null") are always capped at "generated".
   */
  trustLevel?: AppTrustLevel;
}

export function AppPane({
  appId,
  url,
  sendAuth = true,
  isActive = true,
  className,
  trustLevel = "installed",
}: AppPaneProps) {
  const [status, setStatus] = useState<PaneStatus>("loading");
  const [reloadKey, setReloadKey] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const openOverlay = useOverlayStore((s) => s.open);

  // Derive the exact origin once so we never use "*" when posting the session.
  // Also build a per-pane origin checker that includes this app URL explicitly —
  // covers custom-domain Eve installs that don't match *.synap.live or localhost.
  const { targetOrigin, isAllowed } = useMemo(() => {
    let origin: string | null = null;
    try { origin = new URL(url).origin; } catch { /* invalid URL */ }
    return {
      targetOrigin: origin,
      isAllowed: createAllowedEmbedOriginChecker(origin ? [url] : undefined),
    };
  }, [url, reloadKey]);

  // Push the session to a target window using the exact origin.
  // No-op when there is no active session or the origin is unknown.
  const pushSession = useCallback(
    (target: Window) => {
      if (!sendAuth) return;
      if (!targetOrigin) return;
      const session = resolveSessionForEmbed();
      if (!session) return;
      target.postMessage({ type: "synap:auth", session }, targetOrigin);
    },
    [sendAuth, targetOrigin],
  );

  // Load the iframe directly. A separate cross-origin fetch probe is noisy and
  // can fail even when the frame itself is allowed to load.
  useEffect(() => {
    setStatus("loading");
    const timeout = window.setTimeout(() => {
      setStatus((current) => current === "loading" ? "unreachable" : current);
    }, 12000);
    return () => window.clearTimeout(timeout);
  }, [url]);

  // Phase 1 — proactive push once the iframe reports it has loaded.
  const handleLoad = useCallback(() => {
    if (status !== "loading") return;
    setStatus("ready");
    const win = iframeRef.current?.contentWindow;
    if (win) pushSession(win);
  }, [status, pushSession]);

  // Phase 2 — respond to synap:ready pull requests from the child.
  // Always re-register so pushSession and isAllowed closures stay fresh.
  useEffect(() => {
    function handler(e: MessageEvent) {
      if (e.data?.type !== "synap:ready") return;
      if (!e.source || e.source !== iframeRef.current?.contentWindow || !isAllowed(e.origin)) return;
      pushSession(e.source as Window);
    }
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [pushSession, isAllowed]);

  // Overlay bridge — iframes may request system overlays via postMessage.
  // srcdoc iframes have origin "null" and are capped at "generated" trust.
  useEffect(() => {
    function handler(e: MessageEvent) {
      if (e.data?.type !== "eve:overlay:request") return;
      if (!e.source || e.source !== iframeRef.current?.contentWindow) return;
      if (e.origin !== "null" && !isAllowed(e.origin)) return;

      const { overlay, requestId } = e.data as {
        overlay: { kind: SystemOverlayKind };
        requestId: string;
      };
      const effective: AppTrustLevel = e.origin === "null" ? "generated" : trustLevel;
      const allowed = TRUSTED_OVERLAY_KINDS[effective];
      const target = e.source as Window;
      const replyOrigin = e.origin === "null" ? "*" : e.origin;

      if (!allowed.includes(overlay.kind)) {
        target.postMessage(
          { type: "eve:overlay:response", requestId, result: "denied" },
          replyOrigin,
        );
        return;
      }

      openOverlay(overlay.kind, { ...overlay, requestId });

      if (overlay.kind === "vault" || overlay.kind === "permission") {
        // Register callback — overlay resolves it when user approves/denies.
        useOverlayStore.getState().registerPending(requestId, (result, data) => {
          target.postMessage({ type: "eve:overlay:response", requestId, result, data }, replyOrigin);
        });
      } else {
        target.postMessage(
          { type: "eve:overlay:response", requestId, result: "approved" },
          replyOrigin,
        );
      }
    }
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [isAllowed, trustLevel, openOverlay]);

  return (
    <div className={`relative w-full h-full overflow-hidden ${className ?? ""}`}>
      {/* Loading overlay — shown while waiting for iframe load */}
      {status === "loading" && isActive && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background">
          <div className="flex flex-col items-center gap-3">
            <Spinner size="sm" color="primary" />
            <p className="text-xs text-foreground/40">Loading…</p>
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
              onClick={() => setReloadKey((value) => value + 1)}
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
        key={`${url}:${reloadKey}`}
        src={url}
        title={appId}
        className="w-full h-full border-0"
        onLoad={handleLoad}
        allow="clipboard-read; clipboard-write"
        sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"
      />
    </div>
  );
}
