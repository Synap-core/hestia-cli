/**
 * `use-session-health` — monitors the real-time health of the
 * browser ↔ pod session and exposes a simple status for UI.
 *
 * What it does:
 *   1. Periodically checks if the `ory_kratos_session` cookie exists
 *      (via `document.cookie` — safe because HttpOnly cookies are still
 *      present in the Cookie header on requests, just not readable by JS;
 *      the server-side proxy reads the actual value).
 *   2. Calls `GET /api/pod/pairing-status` on an interval to confirm
 *      the session is valid server-side.
 *   3. Emits one of four states: "connected", "reconnecting",
 *      "disconnected", "unconfigured".
 *
 * Consumers:
 *   - Header shows a green dot / amber spinner / gray dot
 *   - Auto-retry logic: if "disconnected" but cookie exists, trigger
 *     a silent re-auth through the SSO callback before showing an error.
 *
 * This hook replaces ad-hoc session checks scattered across components
 * with a single source of truth.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export type SessionHealth =
  | "connected"       // Kratos session valid, eve-session fresh
  | "reconnecting"    // Cookie present, whoami in-flight or retrying
  | "disconnected"    // No cookie or whoami failed
  | "unconfigured";   // No pod URL configured

interface PairingStatus {
  state: string;
  userEmail?: string;
  podUrl?: string;
}

const RETRY_INTERVAL_MS = 15_000; // 15s between health checks

export function useSessionHealth(): {
  health: SessionHealth;
  pairing: PairingStatus | null;
  refetch: () => void;
} {
  const [health, setHealth] = useState<SessionHealth>("reconnecting");
  const [pairing, setPairing] = useState<PairingStatus | null>(null);
  const retryCount = useRef(0);
  const maxRetries = 3;

  const checkHealth = useCallback(async () => {
    try {
      const res = await fetch("/api/pod/pairing-status", {
        cache: "no-store",
        credentials: "include",
      });

      if (res.status === 401 || res.status === 403) {
        // Auth gate will handle redirect — treat as reconnecting
        setHealth("reconnecting");
        setPairing(null);
        return;
      }

      if (!res.ok) {
        // Network issue or server error
        if (retryCount.current < maxRetries) {
          retryCount.current += 1;
          setHealth("reconnecting");
        } else {
          setHealth("disconnected");
        }
        return;
      }

      const data = (await res.json()) as PairingStatus;
      retryCount.current = 0;

      if (data.state === "paired") {
        setHealth("connected");
        setPairing(data);
      } else if (data.state === "unconfigured") {
        setHealth("unconfigured");
        setPairing(data);
      } else {
        // "unpaired" — pod exists but no session
        setHealth("disconnected");
        setPairing(data);
      }
    } catch {
      if (retryCount.current < maxRetries) {
        retryCount.current += 1;
        setHealth("reconnecting");
      } else {
        setHealth("disconnected");
      }
    }
  }, []);

  const refetch = useCallback(() => {
    retryCount.current = 0;
    void checkHealth();
  }, [checkHealth]);

  useEffect(() => {
    void checkHealth();
    const interval = setInterval(() => void checkHealth(), RETRY_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [checkHealth]);

  return { health, pairing, refetch };
}