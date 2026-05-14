"use client";

/**
 * `EveAccountGate` — ensures the operator is authenticated before
 * rendering the dashboard.
 *
 * Single check: verify the `eve-session` JWT cookie via `/api/auth/me`.
 *  • 200 → populate `synap:pods` (for embedded-app postMessage + header)
 *          and render children.
 *  • 401 → redirect to `/login` (cookie gone or expired).
 *
 * After login the `ory_kratos_session` cookie is set at the parent
 * domain, so pod-level auth is handled downstream by `PodConnectGate`
 * (via `pairing-status` → Kratos whoami). This gate only cares about
 * Eve dashboard access.
 *
 * Cross-tab sign-out: a `storage` event on `synap:pods` or
 * `synap:session` re-triggers the check so other open tabs redirect.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { storePodSession } from "@/lib/synap-auth";

interface MeResponse {
  ok: boolean;
  user?: { uid: string; email: string };
  podUrl?: string | null;
}

export interface EveAccountGateProps {
  children: React.ReactNode;
}

export function EveAccountGate({ children }: EveAccountGateProps) {
  const router = useRouter();
  const [verified, setVerified] = useState(false);
  const checkedRef = useRef(false);

  const checkAuth = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me", {
        credentials: "include",
        cache: "no-store",
      });

      if (res.ok) {
        const data = (await res.json().catch(() => null)) as MeResponse | null;
        // Populate synap:pods so embedded apps (app-pane postMessage) and
        // the account menu (home-header-content) have pod URL + email.
        if (data?.podUrl && data?.user) {
          storePodSession({
            podUrl: data.podUrl,
            sessionToken: "",
            userEmail: data.user.email,
            userId: data.user.uid,
          });
        }
        setVerified(true);
      } else {
        router.push("/login");
      }
    } catch {
      router.push("/login");
    }
  }, [router]);

  useEffect(() => {
    if (checkedRef.current) return;
    checkedRef.current = true;
    void checkAuth();
  }, [checkAuth]);

  // Cross-tab sign-out: re-check when another tab clears the session.
  useEffect(() => {
    if (typeof window === "undefined") return;
    function onStorage(e: StorageEvent) {
      if (e.key !== "synap:pods" && e.key !== "synap:session") return;
      checkedRef.current = false;
      void checkAuth();
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [checkAuth]);

  if (!verified) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="h-2 w-24 rounded-full bg-foreground/10 animate-pulse" />
      </div>
    );
  }

  return <>{children}</>;
}

export default EveAccountGate;
