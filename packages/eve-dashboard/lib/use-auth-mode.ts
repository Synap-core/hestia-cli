"use client";

/**
 * `useAuthMode` — single source of truth for which auth surface to show.
 *
 * Maps the raw `PodAuthState` discriminated union onto a clean three-way
 * decision that every sign-in surface in Eve can consume:
 *
 *   kind: "loading"  — still probing pod, render a spinner.
 *
 *   kind: "pod"      — a pod URL is configured. Sub-modes:
 *     submode: "login"       → pod has an admin; show Kratos form.
 *     submode: "bootstrap"   → no admin yet; show first-admin setup.
 *     submode: "unreachable" → pod URL set but pod isn't responding.
 *
 *   kind: "cp"       — no pod URL configured; show Synap CP auth first.
 *                      After CP sign-in, PodConnectGate handles the
 *                      pod-claim handshake.
 *
 * Rule: `kind: "cp"` is returned ONLY when the pod URL is absent
 * (`reason: "no-pod-url"`). Every other non-ready state is modelled
 * as a "pod" mode so the operator can address the pod issue in-place
 * (fix URL, bootstrap admin, retry).
 *
 * Usage:
 *   const mode = useAuthMode();
 *   if (mode.kind === "cp") return <CpSignInPanel />;
 *   if (mode.kind === "pod" && mode.submode === "login") return <KratosForm />;
 *   ...
 *
 * This hook is intentionally thin — it wraps `usePodAuthState` and
 * re-exposes `refetch` so callers can trigger a manual retry without
 * having to understand the underlying state machine.
 */

import { usePodAuthState } from "@/app/(os)/hooks/use-pod-auth-state";

export type AuthMode =
  | { kind: "loading" }
  | {
      kind: "pod";
      submode: "login" | "bootstrap" | "unreachable";
      podUrl: string | null;
      refetch: () => void;
    }
  | { kind: "cp" };

export function useAuthMode(): AuthMode {
  const state = usePodAuthState({ includePairing: false });

  if (state.kind === "loading") return { kind: "loading" };

  // No pod URL at all → CP is the entry point.
  if (state.kind === "unconfigured" && state.reason === "no-pod-url") {
    return { kind: "cp" };
  }

  // Pod is reachable and has an admin → Kratos login.
  if (state.kind === "ready") {
    return {
      kind: "pod",
      submode: "login",
      podUrl: state.podUrl ?? null,
      refetch: state.refetch,
    };
  }

  // Pod reachable but no admin yet → bootstrap form.
  if (state.kind === "needsBootstrap") {
    return {
      kind: "pod",
      submode: "bootstrap",
      podUrl: state.podUrl ?? null,
      refetch: state.refetch,
    };
  }

  // Pod URL set but pod not responding (or other unconfigured reason).
  return {
    kind: "pod",
    submode: "unreachable",
    podUrl: "podUrl" in state ? (state.podUrl ?? null) : null,
    refetch: state.refetch,
  };
}
