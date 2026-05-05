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

import { useCallback, useEffect, useState } from "react";

export type SetupStatusState =
  | "loading"
  | "ready"
  | "needsBootstrap"
  | "unconfigured"
  | "unreachable";

interface SetupStatusResponse {
  initialized: boolean | null;
  reason?: "no-pod-url" | "unreachable";
  version?: string | null;
}

interface UseSetupStatusResult {
  state: SetupStatusState;
  version: string | null;
  refetch: () => void;
}

export function useSetupStatus(): UseSetupStatusResult {
  const [state, setState] = useState<SetupStatusState>("loading");
  const [version, setVersion] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    try {
      const res = await fetch("/api/pod/setup-status", {
        cache: "no-store",
        credentials: "include",
      });
      if (!res.ok) {
        setState("unreachable");
        return;
      }
      const data = (await res.json()) as SetupStatusResponse;

      if (data.initialized === true) {
        setVersion(data.version ?? null);
        setState("ready");
        return;
      }
      if (data.initialized === false) {
        setVersion(data.version ?? null);
        setState("needsBootstrap");
        return;
      }
      // initialized === null — distinguish missing pod URL from upstream error.
      if (data.reason === "no-pod-url") {
        setState("unconfigured");
      } else {
        setState("unreachable");
      }
    } catch {
      setState("unreachable");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { state, version, refetch: load };
}
