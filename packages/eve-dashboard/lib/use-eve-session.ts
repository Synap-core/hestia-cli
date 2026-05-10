"use client";

import { useEffect, useState } from "react";
import { getSharedSession } from "@synap-core/auth";
import type { SharedSession } from "@synap-core/auth";

/**
 * Receives the Synap pod session inside an Eve-embedded app via postMessage.
 *
 * Sends `{ type: "synap:ready" }` on mount (Phase 2 pull) and listens for
 * `{ type: "synap:auth" }` responses from the parent Eve shell. Falls back to
 * any session already in localStorage from a prior handshake.
 *
 * Uses `installEmbeddedAuthReceiver` / `requestEmbeddedAuth` from
 * `@synap-core/auth` once those are available in the published package (>= next
 * minor). For now the protocol is implemented inline — identical behaviour.
 */
export function useEveSession(): SharedSession | null {
  const [session, setSession] = useState<SharedSession | null>(() =>
    typeof window !== "undefined" ? (getSharedSession() ?? null) : null,
  );

  useEffect(() => {
    function handler(e: MessageEvent) {
      if (e.data?.type !== "synap:auth") return;
      const incoming = (e.data as { session: SharedSession }).session;
      if (incoming?.sessionToken) setSession(incoming);
    }

    window.addEventListener("message", handler);
    window.parent.postMessage({ type: "synap:ready", source: "eve-dashboard" }, "*");

    return () => window.removeEventListener("message", handler);
  }, []);

  return session;
}
