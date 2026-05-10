"use client";

/**
 * `usePodPairing` — single source of truth for whether the operator
 * has a usable pod session.
 *
 * Backed by `GET /api/pod/pairing-status`, which forwards the inbound
 * `ory_kratos_session` cookie to the pod's `whoami` endpoint and
 * reports back. Eve persists nothing; the cookie is the only signal.
 *
 * States:
 *   • "loading"        — first fetch in flight (no cache yet)
 *   • "unconfigured"   — no pod URL and no `synap.apiUrl` yet
 *   • "unpaired"       — pod URL set, but no valid Kratos cookie. The
 *                        operator needs to sign in via the pod-admin
 *                        login (or via Eve's own sign-in dialog, which
 *                        proxies to the same Kratos flow).
 *   • "paired"         — Kratos session is live (`whoami` returned 200).
 *
 * Polling: kept light. We refetch on mount and on explicit `refetch()`
 * (post sign-in / sign-out / settings changes). No interval — the
 * states above are user-driven, not time-driven.
 *
 * See: synap-team-docs/content/team/platform/eve-credentials.mdx
 */

import { useCallback, useEffect, useState } from "react";

export type PairingState =
  | "loading"
  | "unconfigured"
  | "unpaired"
  | "paired"
  /**
   * @deprecated Cookie-only auth doesn't expose token expiry to the
   * UI any more. Retained in the union so older code that switches on
   * it still type-checks; the API never returns it.
   */
  | "needs-refresh"
  /**
   * @deprecated Same reason — no eve-side cred to be stale.
   */
  | "stale-cred";

export interface PodPairingResult {
  state: PairingState;
  userEmail?: string;
  podUrl?: string;
  /** ISO-8601, only when token is cached. */
  expiresAt?: string;
  refetch: () => void;
}

interface PairingStatusResponse {
  state: Exclude<PairingState, "loading">;
  userEmail?: string;
  podUrl?: string;
  expiresAt?: string;
}

export function usePodPairing(): PodPairingResult {
  const [state, setState] = useState<PairingState>("loading");
  const [userEmail, setUserEmail] = useState<string | undefined>(undefined);
  const [podUrl, setPodUrl] = useState<string | undefined>(undefined);
  const [expiresAt, setExpiresAt] = useState<string | undefined>(undefined);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/pod/pairing-status", {
        cache: "no-store",
        credentials: "include",
      });
      // 401 means the local Eve dashboard cookie expired — let the
      // outer auth gate handle that. We just treat as `loading` so the
      // CTA doesn't flicker into "Pair your pod" before the redirect.
      if (res.status === 401) {
        setState("loading");
        return;
      }
      if (!res.ok) {
        // Soft fallback — the dashboard is up but the route errored.
        // Treat as `unconfigured` so the operator can at least open
        // settings to repair things.
        setState("unconfigured");
        setUserEmail(undefined);
        setPodUrl(undefined);
        setExpiresAt(undefined);
        return;
      }
      const data = (await res.json()) as PairingStatusResponse;
      setState(data.state);
      setUserEmail(data.userEmail);
      setPodUrl(data.podUrl);
      setExpiresAt(data.expiresAt);
    } catch {
      // Network blip — leave as-is rather than flashing "unconfigured".
      // A subsequent refetch (after the user acts) will clear it.
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { state, userEmail, podUrl, expiresAt, refetch: load };
}
