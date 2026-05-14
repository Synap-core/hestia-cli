"use client";

/**
 * `EveAccountGate` — ensures the operator is authenticated before
 * rendering the dashboard.
 *
 * Auth is handled by a single server-side layer (`proxy.ts` + the
 * `eve-session` JWT cookie). This gate is the CLIENT-SIDE complement:
 * it restores the `synap:pods` localStorage entry that other components
 * read for pod-session data (e.g. podUrl, email).
 *
 * On mount it calls `/api/auth/me` (the server-side source of truth).
 *  • 200 → restore session in localStorage + render children.
 *  • 401 → redirect to `/login` (cookie is gone/expired).
 *
 * The gate never shows its own login form — `/login` is the single
 * auth entry point. `EveSignInScreen` is used elsewhere (bootstrap
 * flow, CP pairing) but not here.
 *
 * Cross-tab sign-out: a `storage` event on `synap:pods` triggers a
 * re-check so logging out in one tab closes the gate in all tabs.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getAllPodSessions,
  getSharedSession,
  storePodSession,
  type SharedSession,
  type StoredPodSession,
} from "@/lib/synap-auth";

const PODS_STORAGE_KEY = "synap:pods";
const SHARED_SESSION_KEY = "synap:session";

interface MeResponse {
  ok: boolean;
  user?: { uid: string; email: string };
  podUrl?: string | null;
}

type GateStatus = "loading" | "signed-in" | "redirecting";

interface GateState {
  status: GateStatus;
  cp?: SharedSession;
  localPod?: StoredPodSession;
}

function readLocalState(localPodUrl: string | null): GateState {
  if (typeof window === "undefined") return { status: "loading" };
  const cp = getSharedSession() ?? undefined;
  let localPod: StoredPodSession | undefined;
  if (localPodUrl) {
    const normalized = localPodUrl.replace(/\/+$/, "");
    localPod = Object.values(getAllPodSessions()).find(
      (s) => s.podUrl.replace(/\/+$/, "") === normalized,
    );
  } else {
    // No pod URL known yet — any pod session counts (loose fallback).
    const all = Object.values(getAllPodSessions());
    localPod = all[0];
  }
  if (cp || localPod) return { status: "signed-in", cp, localPod };
  return { status: "loading" }; // pending server check
}

export interface EveAccountGateProps {
  children: React.ReactNode;
}

export function EveAccountGate({ children }: EveAccountGateProps) {
  const router = useRouter();
  const [state, setState] = useState<GateState>({ status: "loading" });
  const checkedRef = useRef(false);

  const checkAuth = useCallback(async () => {
    // Fast path: localStorage already has a session for the local pod.
    // We still ping /api/auth/me to get the canonical podUrl, but we
    // can render optimistically while we wait.
    const optimistic = readLocalState(null);
    if (optimistic.status === "signed-in") {
      setState(optimistic);
    }

    try {
      const res = await fetch("/api/auth/me", {
        credentials: "include",
        cache: "no-store",
      });

      if (res.ok) {
        const data = (await res.json().catch(() => null)) as MeResponse | null;
        const podUrl = data?.podUrl ?? null;
        const user = data?.user;

        // Ensure localStorage is populated so cross-app components have
        // the podUrl + email available without an extra API call.
        if (podUrl && user) {
          const existing = readLocalState(podUrl);
          if (existing.status !== "signed-in") {
            storePodSession({
              podUrl,
              sessionToken: "",
              userEmail: user.email,
              userId: user.uid,
            });
          }
        }

        setState({ status: "signed-in" });
      } else {
        // Cookie is gone or expired — send to login.
        setState({ status: "redirecting" });
        router.push("/login");
      }
    } catch {
      // Network error — if we already have a localStorage session,
      // keep rendering optimistically. Otherwise redirect.
      const fallback = readLocalState(null);
      if (fallback.status === "signed-in") {
        setState(fallback);
      } else {
        setState({ status: "redirecting" });
        router.push("/login");
      }
    }
  }, [router]);

  // Run once on mount.
  useEffect(() => {
    if (checkedRef.current) return;
    checkedRef.current = true;
    void checkAuth();
  }, [checkAuth]);

  // Cross-tab sign-out: re-check when storage changes.
  useEffect(() => {
    if (typeof window === "undefined") return;
    function onStorage(e: StorageEvent) {
      if (e.key !== PODS_STORAGE_KEY && e.key !== SHARED_SESSION_KEY) return;
      checkedRef.current = false;
      void checkAuth();
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [checkAuth]);

  if (state.status === "loading" || state.status === "redirecting") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="h-2 w-24 rounded-full bg-foreground/10 animate-pulse" />
      </div>
    );
  }

  return <>{children}</>;
}

export default EveAccountGate;
