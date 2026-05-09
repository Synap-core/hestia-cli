"use client";

/**
 * `useSetupStatus` — does the user's pod have any human users yet?
 *
 * Polled once on mount. Powers the Home page's decision between the
 * normal launcher and the "Set up your first admin" card.
 *
 * States:
 *   • "loading"          — initial fetch in flight
 *   • "ready"            — pod reachable, `initialized: true`
 *   • "needsBootstrap"   — pod reachable, `initialized: false`
 *   • "unconfigured"     — Eve doesn't know a pod URL yet
 *   • "unreachable"      — pod URL configured but the probe failed
 *
 * The home page's existing `useHomeApps` / `useStats` hooks keep
 * running — they handle their own auth gracefully and the OS should
 * still feel "alive" while the setup card is shown.
 *
 * See: synap-team-docs/content/team/platform/eve-auth-architecture.mdx
 */

import { usePodAuthState } from "./use-pod-auth-state";

export type SetupStatusState =
  | "loading"
  | "ready"
  | "needsBootstrap"
  | "unconfigured"
  | "unreachable";

interface UseSetupStatusResult {
  state: SetupStatusState;
  /** True only during a background refetch — the last known state is still exposed. */
  isRefreshing: boolean;
  version: string | null;
  refetch: () => void;
}

export function useSetupStatus(): UseSetupStatusResult {
  const podAuth = usePodAuthState({ includePairing: false });
  return {
    state: podAuth.kind === "loading" ? "loading" : podAuth.kind,
    isRefreshing: podAuth.isRefreshing,
    version:
      podAuth.kind === "ready" ||
      podAuth.kind === "needsBootstrap" ||
      podAuth.kind === "unreachable"
        ? podAuth.version
        : null,
    refetch: podAuth.refetch,
  };
}
