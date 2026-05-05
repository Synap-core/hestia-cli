"use client";

/**
 * `usePodPairing` — single source of truth for whether the operator's
 * pod user-channel is signed in.
 *
 * Backed by `GET /api/pod/pairing-status` which inspects
 * `~/.eve/secrets.json` (`pod.userToken`, `pod.userEmail`,
 * `pod.userTokenExpiresAt`) and returns a tagged state. The token
 * itself never reaches the browser.
 *
 * States:
 *   • "loading"        — first fetch in flight (no cache yet)
 *   • "unconfigured"   — no pod URL and no `synap.apiUrl` yet
 *   • "unpaired"       — pod URL set, no token, but `userEmail` cached.
 *                        Re-sign-in is a single click ("Sign in as
 *                        {email}") because the pod-signin route only
 *                        needs the email.
 *   • "paired"         — token exists and is comfortably valid.
 *   • "needs-refresh"  — token exists but expired/about-to. The proxy
 *                        will re-mint on next call when given an email,
 *                        so the UX still treats this as paired.
 *   • "stale-cred"     — pod URL set, no token, AND no `userEmail` cached
 *                        (e.g. fresh install where `eve setup admin`
 *                        wasn't run, or a manual secrets-file wipe).
 *                        Needs the full email prompt path.
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
  | "needs-refresh"
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
