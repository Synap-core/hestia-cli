"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export interface PinnedApp {
  id: string;
  name: string;
  slug: string;
  url: string;
  iconUrl?: string | null;
}

interface PinContextValue {
  pinnedApps: PinnedApp[];
  pinnedIds: Set<string>;
  pin: (app: PinnedApp) => Promise<void>;
  unpin: (appId: string) => Promise<void>;
}

const PinContext = createContext<PinContextValue>({
  pinnedApps: [],
  pinnedIds: new Set(),
  pin: async () => {},
  unpin: async () => {},
});

export function PinContextProvider({ children }: { children: React.ReactNode }) {
  const [pinnedApps, setPinnedApps] = useState<PinnedApp[]>([]);

  useEffect(() => {
    fetch("/api/preferences/home", { credentials: "include", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json: { pinnedApps?: PinnedApp[] } | null) => {
        if (json?.pinnedApps) setPinnedApps(json.pinnedApps);
      })
      .catch(() => {});
  }, []);

  const persist = useCallback(async (next: PinnedApp[]) => {
    setPinnedApps(next);
    await fetch("/api/preferences/home", {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinnedApps: next }),
    });
  }, []);

  const pin = useCallback(
    async (app: PinnedApp) => {
      const next = [...pinnedApps.filter((a) => a.id !== app.id), app];
      await persist(next);
    },
    [pinnedApps, persist],
  );

  const unpin = useCallback(
    async (appId: string) => {
      const next = pinnedApps.filter((a) => a.id !== appId);
      await persist(next);
    },
    [pinnedApps, persist],
  );

  const pinnedIds = useMemo(
    () => new Set(pinnedApps.map((a) => a.id)),
    [pinnedApps],
  );

  const value = useMemo(
    () => ({ pinnedApps, pinnedIds, pin, unpin }),
    [pinnedApps, pinnedIds, pin, unpin],
  );

  return <PinContext.Provider value={value}>{children}</PinContext.Provider>;
}

export function usePinContext(): PinContextValue {
  return useContext(PinContext);
}
