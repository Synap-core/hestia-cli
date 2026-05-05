"use client";

/**
 * `useActiveWorkspace` — the dashboard's per-tab active workspace state.
 *
 * Background. The pod ships every operator with at least one workspace
 * (the personal pod-admin workspace), and any feature that calls a
 * `workspaceProcedure` on the pod needs an `x-workspace-id` header to
 * pick the lens. Eve doesn't have a workspace switcher in the UI yet,
 * so we pick the first workspace returned by `workspaces.list` and
 * persist it to `localStorage` under `eve.activeWorkspaceId`. Once the
 * switcher lands the same key feeds it.
 *
 * Resolution order:
 *
 *   1. localStorage (cached across reloads, also survives tab restore).
 *   2. `GET /api/pod/trpc/workspaces.list` → take `[0].id`, persist it.
 *
 * Cross-tab sync: a custom `eve:active-workspace-changed` window event
 * is dispatched on every setter call so other components on the same
 * page can react. The native `storage` event covers cross-tab sync.
 *
 * Failure mode. When `workspaces.list` errors (no pod session, network
 * blip), the hook stops loading and returns `workspaceId: null`. Any
 * caller that depends on a workspaceId should fall back to a friendly
 * empty state — see `notifications-panel.tsx` for the pattern.
 */

import { useCallback, useEffect, useRef, useState } from "react";

const STORAGE_KEY = "eve.activeWorkspaceId";
const CHANGE_EVENT = "eve:active-workspace-changed";

interface WireWorkspace {
  id: string;
}

/**
 * tRPC + superjson envelope shape (mirrors the `unwrapTrpc` in
 * `proposals-panel.tsx`). Centralising the helper inside this hook
 * keeps it dependency-free; the inbox helpers live in `inbox/lib/`.
 */
interface TrpcEnvelope<T> {
  result?: { data?: { json?: T } | T };
}

function unwrapTrpc<T>(env: TrpcEnvelope<T> | null): T | null {
  if (!env) return null;
  const data = env.result?.data;
  if (data && typeof data === "object" && "json" in data) {
    return (data as { json?: T }).json ?? null;
  }
  return (data as T) ?? null;
}

function readStored(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

function writeStored(id: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (id) window.localStorage.setItem(STORAGE_KEY, id);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* localStorage disabled — accept silently */
  }
}

export interface UseActiveWorkspaceResult {
  workspaceId: string | null;
  isLoading: boolean;
  refetch: () => void;
  setActiveWorkspace: (id: string | null) => void;
}

export function useActiveWorkspace(): UseActiveWorkspaceResult {
  // Hydrate from storage synchronously to avoid a flash of "no workspace"
  // on each panel mount. SSR-safe (returns null on the server, hydrates
  // on first effect).
  const [workspaceId, setWorkspaceId] = useState<string | null>(() =>
    readStored(),
  );
  const [isLoading, setIsLoading] = useState<boolean>(() => readStored() === null);
  const inFlight = useRef<Promise<void> | null>(null);

  const setActiveWorkspace = useCallback((id: string | null) => {
    writeStored(id);
    setWorkspaceId(id);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { id } }));
    }
  }, []);

  const fetchAndPick = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    try {
      // No input arg → bare query. tRPC accepts an empty `input` param.
      const r = await fetch("/api/pod/trpc/workspaces.list", {
        credentials: "include",
        cache: "no-store",
      });
      if (!r.ok) {
        // Pairing / session / network error — leave id null, stop loading.
        setIsLoading(false);
        return;
      }
      const json = (await r.json().catch(() => null)) as TrpcEnvelope<
        WireWorkspace[]
      > | null;
      const list = unwrapTrpc(json);
      const first = Array.isArray(list) && list.length > 0 ? list[0] : null;
      if (first && typeof first.id === "string" && first.id.length > 0) {
        setActiveWorkspace(first.id);
      }
    } catch {
      /* swallow — caller will see workspaceId === null and render empty */
    } finally {
      setIsLoading(false);
    }
  }, [setActiveWorkspace]);

  const refetch = useCallback(() => {
    if (inFlight.current) return;
    inFlight.current = fetchAndPick().finally(() => {
      inFlight.current = null;
    });
  }, [fetchAndPick]);

  // First-mount: if we don't have a cached id, ask the pod.
  useEffect(() => {
    if (workspaceId === null) {
      refetch();
    } else {
      setIsLoading(false);
    }
    // We intentionally only run this once on mount. Subsequent changes
    // come through the setter or the cross-tab listeners below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cross-component / cross-tab sync.
  useEffect(() => {
    if (typeof window === "undefined") return;

    const onCustom = (e: Event) => {
      const detail = (e as CustomEvent<{ id: string | null }>).detail;
      const next = detail?.id ?? null;
      // Only update local state when it really changed; avoids a render
      // loop when *we* dispatched the event from this hook instance.
      setWorkspaceId((prev) => (prev === next ? prev : next));
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      setWorkspaceId(e.newValue ?? null);
    };

    window.addEventListener(CHANGE_EVENT, onCustom as EventListener);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(CHANGE_EVENT, onCustom as EventListener);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  return { workspaceId, isLoading, refetch, setActiveWorkspace };
}

/**
 * Synchronous read for non-React code (e.g. `pod-fetch.ts`). Returns
 * `null` on the server. Don't expose a setter here — mutations must
 * route through `useActiveWorkspace().setActiveWorkspace` so that
 * subscribers update.
 */
export function readActiveWorkspaceId(): string | null {
  return readStored();
}

/** Constant export — keep the storage key in one place. */
export const ACTIVE_WORKSPACE_STORAGE_KEY = STORAGE_KEY;
