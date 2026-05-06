"use client";

/**
 * `EveAccountGate` — top-level gate that ensures the operator is signed
 * into either the Synap Control Plane (cross-app shared session) OR has
 * bootstrapped a self-hosted pod (mode marker on the shared session).
 *
 * Boot sequence:
 *
 *   1. Read `getSharedSession()` synchronously on mount. If a session
 *      exists locally, render children optimistically — every other
 *      Synap surface does the same so the OS feels instant.
 *
 *   2. In parallel, call `checkCpSession()` to revalidate against the
 *      CP. If the session is stale (cookie expired, account deleted),
 *      drop back to the sign-in screen. We skip this revalidation for
 *      `mode: "self-hosted"` sessions — those don't have a CP record.
 *
 *   3. Listen for `storage` events so a sign-out in another tab (or
 *      another Synap app on the same domain) clears the gate here too.
 *
 * The gate does NOT manage pod connection — that's `PodConnectGate`'s
 * job, which composes underneath this one.
 *
 * See:
 *   synap-team-docs/content/team/platform/eve-auth-architecture.mdx
 *   synap-app/packages/core/auth/src/storage/shared-session.ts
 */

import { useCallback, useEffect, useState } from "react";
import {
  checkCpSession,
  getSharedSession,
  isSelfHostedSession,
  type SharedSession,
} from "@/lib/synap-auth";
import { EveSignInScreen, type EveSignInMode } from "./EveSignInScreen";

const SHARED_SESSION_KEY = "synap:session";

interface GateState {
  status: "loading" | "signed-out" | "signed-in";
  session?: SharedSession;
}

export interface EveAccountGateProps {
  children: React.ReactNode;
}

export function EveAccountGate({ children }: EveAccountGateProps) {
  const [state, setState] = useState<GateState>(() => {
    if (typeof window === "undefined") return { status: "loading" };
    const session = getSharedSession();
    return session ? { status: "signed-in", session } : { status: "signed-out" };
  });

  // ── CP revalidation ───────────────────────────────────────────────────
  // Skip for self-hosted sessions (no CP record to check) and for the
  // signed-out path (nothing to validate). Failure means the local
  // session lied — drop the user back to sign-in.
  useEffect(() => {
    if (state.status !== "signed-in" || !state.session) return;
    if (isSelfHostedSession(state.session)) return;
    let cancelled = false;
    void (async () => {
      try {
        const cp = await checkCpSession();
        if (cancelled) return;
        if (!cp) {
          setState({ status: "signed-out" });
        }
      } catch {
        // Network blip — keep optimistic render. Next reload re-checks.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [state.status, state.session]);

  // ── Cross-tab sign-out ────────────────────────────────────────────────
  useEffect(() => {
    if (typeof window === "undefined") return;
    function onStorage(e: StorageEvent) {
      if (e.key !== SHARED_SESSION_KEY) return;
      if (!e.newValue) {
        setState({ status: "signed-out" });
        return;
      }
      try {
        const session = JSON.parse(e.newValue) as SharedSession;
        setState({ status: "signed-in", session });
      } catch {
        setState({ status: "signed-out" });
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const handleSuccess = useCallback((mode: EveSignInMode) => {
    // The wrapper has already written `localStorage.synap:session`.
    // Re-read it so the gate-managed `state` is the source of truth.
    const session = getSharedSession();
    if (session) {
      setState({ status: "signed-in", session });
      return;
    }
    // Fallback — synthesise a minimal session so the gate doesn't
    // bounce back to sign-in if something went wrong with the shared
    // storage write. (Self-hosted mode synthesises here.)
    if (mode.kind === "self-hosted") {
      setState({
        status: "signed-in",
        session: {
          podUrl: mode.podUrl,
          sessionToken: "",
          workspaceId: null,
          userId: "",
          userName: mode.email,
        } as SharedSession,
      });
    } else {
      setState({
        status: "signed-in",
        session: {
          podUrl: "",
          sessionToken: mode.session.token,
          workspaceId: null,
          userId: mode.session.userId,
          userName: mode.session.name ?? "",
        },
      });
    }
  }, []);

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
