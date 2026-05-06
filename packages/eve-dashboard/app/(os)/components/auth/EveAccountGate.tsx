"use client";

/**
 * `EveAccountGate` — top-level gate that ensures the operator is
 * authenticated through at least one of two **orthogonal** layers:
 *
 *   • **CP layer**  — Synap account (`getSharedSession()`).
 *   • **Pod layer** — Kratos session for the local Eve pod URL,
 *                     stored in the per-pod `synap:pods` map (read via
 *                     `getAllPodSessions()`).
 *
 * "Signed in" means **CP session OR pod session for the local pod**.
 * Either alone is sufficient — a user may opt out of the Synap
 * account entirely and still drive Eve through their local pod
 * (Mode B / self-hosted).
 *
 * Boot sequence:
 *
 *   1. Read both layers synchronously on mount. If at least one is
 *      present, render children optimistically.
 *   2. In parallel, ask `/api/secrets-summary` for the local pod URL
 *      (so we can disambiguate "signed in to local pod" from "signed
 *      in to some unrelated pod").
 *   3. Revalidate the CP session against CP via `checkCpSession()`.
 *      Skip when the only layer present is pod — there's no CP record
 *      to check.
 *   4. Listen for `storage` events on BOTH `synap:session` (CP) and
 *      `synap:pods` (pods) so a sign-out in another tab clears the
 *      gate here too.
 *
 * The gate does NOT manage pod connection — that's `PodConnectGate`'s
 * job, which composes underneath this one.
 *
 * See:
 *   synap-team-docs/content/team/platform/eve-auth-architecture.mdx
 *   synap-app/packages/core/auth/src/storage/shared-session.ts
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  checkCpSession,
  getAllPodSessions,
  getSharedSession,
  isSelfHostedSession,
  type SharedSession,
  type StoredPodSession,
} from "@/lib/synap-auth";
import { EveSignInScreen, type EveSignInMode } from "./EveSignInScreen";

const SHARED_SESSION_KEY = "synap:session";
const PODS_STORAGE_KEY = "synap:pods";

interface GateState {
  status: "loading" | "signed-out" | "signed-in";
  /** CP session — present iff the user has a Synap account. */
  cp?: SharedSession;
  /** Pod session for the LOCAL pod URL — present iff Mode B / both. */
  localPod?: StoredPodSession;
}

/**
 * Resolve gate status from current localStorage + the local pod URL.
 * Pure — easy to call from useEffect listeners.
 */
function resolveStatus(localPodUrl: string | null): GateState {
  if (typeof window === "undefined") return { status: "loading" };
  const cp = getSharedSession() ?? undefined;
  let localPod: StoredPodSession | undefined;
  if (localPodUrl) {
    const all = getAllPodSessions();
    const normalized = localPodUrl.replace(/\/+$/, "");
    localPod = Object.values(all).find(
      (s) => s.podUrl.replace(/\/+$/, "") === normalized,
    );
  }
  if (cp || localPod) {
    return { status: "signed-in", cp, localPod };
  }
  return { status: "signed-out" };
}

export interface EveAccountGateProps {
  children: React.ReactNode;
}

export function EveAccountGate({ children }: EveAccountGateProps) {
  const [localPodUrl, setLocalPodUrl] = useState<string | null>(null);
  const [state, setState] = useState<GateState>(() => resolveStatus(null));
  // Ref so the CP revalidation effect can read current state values
  // without them being reactive dependencies (avoids infinite loop).
  const stateRef = useRef(state);
  stateRef.current = state;

  // ── Resolve the local pod URL ─────────────────────────────────────────
  // Used to disambiguate "signed in to local pod" from "signed in to
  // some other pod". Failure leaves `localPodUrl` null — the gate
  // then only considers CP sessions and any pod session counts toward
  // signed-in (loose fallback so we don't lock users out).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/secrets-summary", {
          credentials: "include",
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = (await res.json().catch(() => null)) as
          | { synap?: { apiUrl?: string | null } }
          | null;
        const url = data?.synap?.apiUrl ?? null;
        if (!cancelled) {
          setLocalPodUrl(url);
          setState(resolveStatus(url));
        }
      } catch {
        // Network blip — leave `localPodUrl` null. The fallback path
        // below treats "any pod session" as Mode B.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── CP revalidation ───────────────────────────────────────────────────
  // Skip when there's no CP session to check (Mode B or signed-out).
  // IMPORTANT: read state.cp via stateRef, NOT as a reactive dep.
  // state.cp is excluded from the dep array on purpose: getSharedSession()
  // returns a new object reference every time, so including state.cp
  // would cause setState → new reference → re-run → infinite loop.
  useEffect(() => {
    const { status, cp } = stateRef.current;
    if (status !== "signed-in" || !cp) return;
    if (isSelfHostedSession(cp)) return;
    let cancelled = false;
    void (async () => {
      try {
        const validCp = await checkCpSession();
        if (cancelled) return;
        if (!validCp) {
          // CP session is gone. Re-resolve — if the user still has a
          // pod session for the local pod, they remain signed-in
          // (Mode B). Otherwise they fall back to signed-out.
          setState(resolveStatus(localPodUrl));
        }
      } catch {
        // Network blip — keep optimistic render. Next reload re-checks.
      }
    })();
    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status, localPodUrl]);

  // ── Cross-tab sign-in/sign-out (CP + pods) ────────────────────────────
  useEffect(() => {
    if (typeof window === "undefined") return;
    function onStorage(e: StorageEvent) {
      if (e.key !== SHARED_SESSION_KEY && e.key !== PODS_STORAGE_KEY) return;
      // Re-resolve from current localStorage for whichever layer
      // changed. Either layer flipping can change the gate state.
      setState(resolveStatus(localPodUrl));
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [localPodUrl]);

  const handleSuccess = useCallback(
    (mode: EveSignInMode) => {
      // Re-resolve so the gate-managed `state` is the source of truth.
      const resolved = resolveStatus(localPodUrl);
      if (resolved.status === "signed-in") {
        setState(resolved);
        return;
      }
      // Self-hosted path: synthesise a minimal session so the gate
      // doesn't bounce back to sign-in if the wrapper failed to persist.
      setState({
        status: "signed-in",
        cp: {
          podUrl: mode.podUrl,
          sessionToken: "",
          workspaceId: null,
          userId: "",
          userName: mode.email,
        } as SharedSession,
      });
    },
    [localPodUrl],
  );

  if (state.status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="h-2 w-24 rounded-full bg-foreground/10 animate-pulse" />
      </div>
    );
  }

  if (state.status === "signed-out") {
    return <EveSignInScreen onSuccess={handleSuccess} />;
  }

  return <>{children}</>;
}

export default EveAccountGate;
