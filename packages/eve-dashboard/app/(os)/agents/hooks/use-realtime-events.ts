"use client";

/**
 * `useRealtimeEvents` — Socket.IO subscription for the Agents app.
 *
 * Connects to the pod's realtime server (default port 4001, namespace
 * `/presence`, path `/socket.io/`) using an API key fetched from
 * `/api/realtime/credentials`. Auto-joins the workspace room based on
 * the workspace ID returned by the credentials endpoint.
 *
 * Exposes:
 *   • events       — sliding window of the last N events (default 200)
 *   • status       — "idle" | "connecting" | "connected" | "error"
 *   • errorMessage — when status === "error"
 *
 * The hook holds ONE active Socket.IO connection per page. It auto-
 * reconnects via Socket.IO's built-in retry; on hard error it surfaces
 * a recoverable state so the UI can show a "retry" affordance.
 *
 * See: synap-team-docs/content/team/platform/eve-agents-design.mdx
 *      synap-team-docs/content/team/platform/eve-os-vision.mdx
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import {
  EVENT_NAMES,
  type AgentEvent,
  type EventName,
  timestampFor,
} from "../lib/event-types";

interface RealtimeCredentials {
  podUrl: string;
  realtimeUrl: string;
  apiKey: string;
}

export type RealtimeStatus =
  | { kind: "idle" }
  | { kind: "connecting" }
  | { kind: "connected" }
  | { kind: "unauthenticated" }   // pod not paired
  | { kind: "error"; message: string };

export interface UseRealtimeEventsOptions {
  /** How many events to keep in the buffer. Older events are evicted FIFO. */
  bufferSize?: number;
  /** Optional workspace ID — overrides the default (CP-paired workspace). */
  workspaceId?: string;
}

export interface UseRealtimeEventsResult {
  events: AgentEvent[];
  status: RealtimeStatus;
  /** Force a reconnect — useful for the "retry" affordance. */
  reconnect: () => void;
  /** Wipe the in-memory buffer. */
  clear: () => void;
}

const DEFAULT_BUFFER_SIZE = 200;

export function useRealtimeEvents(
  opts: UseRealtimeEventsOptions = {},
): UseRealtimeEventsResult {
  const bufferSize = opts.bufferSize ?? DEFAULT_BUFFER_SIZE;
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [status, setStatus] = useState<RealtimeStatus>({ kind: "idle" });
  const socketRef = useRef<Socket | null>(null);
  const counterRef = useRef(0);
  const tickRef = useRef(0);

  const append = useCallback(
    (name: EventName, payload: unknown) => {
      counterRef.current += 1;
      const id = `${name}#${counterRef.current}`;
      const evt: AgentEvent = {
        id,
        name,
        at: timestampFor(name, payload),
        payload,
      };
      setEvents(prev => {
        const next = [evt, ...prev];
        return next.length > bufferSize ? next.slice(0, bufferSize) : next;
      });
    },
    [bufferSize],
  );

  const connect = useCallback(async () => {
    const tick = ++tickRef.current;
    setStatus({ kind: "connecting" });

    // Step 1 — fetch the credentials from the dashboard's server-side route.
    let creds: RealtimeCredentials;
    try {
      const res = await fetch("/api/realtime/credentials", {
        credentials: "include",
        cache: "no-store",
      });
      if (res.status === 503) {
        if (tickRef.current !== tick) return;
        setStatus({ kind: "unauthenticated" });
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      creds = (await res.json()) as RealtimeCredentials;
    } catch (e) {
      if (tickRef.current !== tick) return;
      setStatus({
        kind: "error",
        message: `Couldn't fetch credentials: ${e instanceof Error ? e.message : "unknown"}`,
      });
      return;
    }

    if (tickRef.current !== tick) return;

    // Step 2 — open the Socket.IO connection.
    const socket: Socket = io(creds.realtimeUrl, {
      path: "/socket.io/",
      transports: ["websocket", "polling"],
      auth: {
        apiKey: creds.apiKey,
        ...(opts.workspaceId ? { workspaceId: opts.workspaceId } : {}),
      },
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 8000,
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      if (tickRef.current !== tick) return;
      setStatus({ kind: "connected" });
    });

    // Step 3 — subscribe to each typed event name. Auto-room-join means we
    // don't need to call `subscribe` ourselves; the pod has already routed
    // events into the `workspace:<id>` and `user:<id>` rooms our handshake
    // joined.
    for (const name of EVENT_NAMES) {
      socket.on(name, (payload: unknown) => {
        if (tickRef.current !== tick) return;
        append(name, payload);
      });
    }

    socket.on("connect_error", (e: Error) => {
      if (tickRef.current !== tick) return;
      setStatus({ kind: "error", message: e.message });
    });

    socket.on("disconnect", reason => {
      if (tickRef.current !== tick) return;
      // Auto-reconnect kicks in for transport-level disconnects. Only flip
      // status to "error" for explicit server kicks.
      if (reason === "io server disconnect") {
        setStatus({ kind: "error", message: "Server closed the connection" });
      }
    });
  }, [append, opts.workspaceId]);

  const reconnect = useCallback(() => {
    socketRef.current?.disconnect();
    socketRef.current = null;
    void connect();
  }, [connect]);

  const clear = useCallback(() => setEvents([]), []);

  useEffect(() => {
    void connect();
    return () => {
      socketRef.current?.disconnect();
      socketRef.current = null;
      tickRef.current += 1;
    };
  }, [connect]);

  return { events, status, reconnect, clear };
}
