"use client";

/**
 * `usePodAuthState` — typed client view of pod setup + user-channel auth.
 *
 * The setup probe tells us whether the pod exists and has a first admin.
 * The optional pairing probe tells us whether Eve has a cached user token
 * for that pod. Keeping these as a discriminated union prevents callers
 * from accidentally treating "unreachable", "unconfigured", and "needs
 * bootstrap" as the same falsey setup state.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { PairingState } from "./use-pod-pairing";

export type PodAuthKind =
  | "loading"
  | "unconfigured"
  | "unreachable"
  | "needsBootstrap"
  | "ready";

export type PodAuthState =
  | { kind: "loading"; isRefreshing: boolean; refetch: () => void }
  | {
      kind: "unconfigured";
      reason: "no-pod-url" | string;
      isRefreshing: boolean;
      refetch: () => void;
    }
  | {
      kind: "unreachable";
      reason: string;
      podUrl?: string;
      version: string | null;
      isRefreshing: boolean;
      refetch: () => void;
    }
  | {
      kind: "needsBootstrap";
      podUrl?: string;
      version: string | null;
      pairing?: PodPairingSnapshot;
      isRefreshing: boolean;
      refetch: () => void;
    }
  | {
      kind: "ready";
      podUrl?: string;
      version: string | null;
      pairing?: PodPairingSnapshot;
      isRefreshing: boolean;
      refetch: () => void;
    };

export type PodPairingSnapshot = {
  state: Exclude<PairingState, "loading">;
  userEmail?: string;
  podUrl?: string;
  expiresAt?: string;
};

interface SetupStatusResponse {
  initialized: boolean | null;
  reason?: string;
  version?: string | null;
  podUrl?: string;
}

interface PairingStatusResponse extends PodPairingSnapshot {}

interface UsePodAuthStateOptions {
  /**
   * Pairing status requires the local dashboard auth cookie. Leave this off
   * for pre-auth or public sign-in surfaces that only need setup status.
   */
  includePairing?: boolean;
}

type WithoutRefetch<T> = T extends unknown ? Omit<T, "refetch"> : never;
type InternalPodAuthState = WithoutRefetch<PodAuthState>;

export function usePodAuthState(
  options: UsePodAuthStateOptions = {},
): PodAuthState {
  const { includePairing = false } = options;
  const [state, setState] = useState<InternalPodAuthState>({
    kind: "loading",
    isRefreshing: false,
  });
  const initialLoadDone = useRef(false);

  const load = useCallback(async () => {
    const refreshing = initialLoadDone.current;
    if (refreshing) {
      setState((current) => ({ ...current, isRefreshing: true }));
    } else {
      setState({ kind: "loading", isRefreshing: false });
    }

    try {
      const setupRes = await fetch("/api/pod/setup-status", {
        cache: "no-store",
        credentials: "include",
      });

      if (!setupRes.ok) {
        setState({
          kind: "unreachable",
          reason: `setup-status-${setupRes.status}`,
          version: null,
          isRefreshing: false,
        });
        return;
      }

      const setup = (await setupRes.json().catch(() => null)) as
        | SetupStatusResponse
        | null;

      if (!setup || setup.initialized === null) {
        const reason = setup?.reason ?? "unknown";
        setState(
          reason === "no-pod-url"
            ? { kind: "unconfigured", reason, isRefreshing: false }
            : {
                kind: "unreachable",
                reason,
                podUrl: setup?.podUrl,
                version: setup?.version ?? null,
                isRefreshing: false,
              },
        );
        return;
      }

      const pairing = includePairing ? await fetchPairingSnapshot() : undefined;
      setState({
        kind: setup.initialized ? "ready" : "needsBootstrap",
        podUrl: setup.podUrl ?? pairing?.podUrl,
        version: setup.version ?? null,
        pairing,
        isRefreshing: false,
      });
    } catch (err) {
      setState({
        kind: "unreachable",
        reason: err instanceof Error ? err.message : "fetch-exception",
        version: null,
        isRefreshing: false,
      });
    } finally {
      initialLoadDone.current = true;
    }
  }, [includePairing]);

  useEffect(() => {
    void load();
  }, [load]);

  return { ...state, refetch: load };
}

async function fetchPairingSnapshot(): Promise<PodPairingSnapshot | undefined> {
  const res = await fetch("/api/pod/pairing-status", {
    cache: "no-store",
    credentials: "include",
  });

  if (res.status === 401) return undefined;
  if (!res.ok) {
    return { state: "unconfigured" };
  }

  return (await res.json().catch(() => undefined)) as
    | PairingStatusResponse
    | undefined;
}
