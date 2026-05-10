"use client";

/**
 * `useEveSession` — receive the Synap pod session inside an Eve-embedded app.
 *
 * Works in two modes:
 *
 *   Host mode (running as the Eve OS itself):
 *     Returns the stored SharedSession from localStorage immediately.
 *
 *   Embedded mode (running inside an Eve AppPane iframe):
 *     Sends `synap:ready` to the parent on mount (Phase 2 pull), then
 *     resolves once Eve responds with `synap:auth`. Falls back to any
 *     session already in localStorage from a prior handshake.
 *
 * Security: only messages whose type is `synap:auth` and that carry a
 * non-empty `sessionToken` are accepted — all others are ignored.
 *
 * Usage (in an embedded Synap app):
 *
 *   const session = useEveSession();
 *   if (!session) return <Loading />;
 *   // session.podUrl, session.sessionToken, session.workspaceId, …
 */

import { useEffect, useState } from "react";
import { getSharedSession, type SharedSession } from "@/lib/synap-auth";

export function useEveSession(): SharedSession | null {
  const [session, setSession] = useState<SharedSession | null>(() =>
    typeof window !== "undefined" ? (getSharedSession() ?? null) : null,
  );

  useEffect(() => {
    // Phase 2 pull — signal to the parent Eve shell that this app is ready.
    // Eve will respond with { type: "synap:auth", session: SharedSession }.
    // Safe to call even when not embedded (parent ignores unknown messages).
    window.parent.postMessage({ type: "synap:ready" }, "*");

    function handler(e: MessageEvent) {
      if (e.data?.type !== "synap:auth") return;
      const incoming = (e.data as { session: SharedSession }).session;
      if (incoming?.sessionToken) setSession(incoming);
    }

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  return session;
}
