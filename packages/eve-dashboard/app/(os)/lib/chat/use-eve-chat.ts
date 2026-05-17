"use client";

/**
 * `useEveChat` — native Synap chat plumbing for the Eve companion.
 *
 * Three responsibilities:
 *   1. Resolve a default channel id (the operator's pod-wide personal
 *      THREAD) the first time the companion mounts.
 *   2. Hydrate that channel's messages from the pod via
 *      `chat.getMessages` (REST through `/api/pod/trpc/*`).
 *   3. Subscribe to the pod's Socket.IO realtime bridge for
 *      `chat:stream` (token-level streaming) and `chat:message`
 *      (finalised assistant rows), accumulating the stream into a
 *      single in-flight assistant bubble.
 *
 * Authoring follows the existing `useRealtimeEvents` pattern in
 * `app/(os)/agents/hooks/use-realtime-events.ts`: credentials come from
 * `/api/realtime/credentials`, one Socket.IO connection per hook
 * instance, auto-reconnect via Socket.IO defaults. Same-origin REST
 * calls flow through `/api/pod/[...path]/route.ts` which forwards the
 * Kratos session cookie.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type {
  ChatMessage,
  ChatMessagePayload,
  ChatStreamPayload,
  PodChannel,
  PodMessage,
  StreamState,
} from "./types";

interface TrpcEnvelope<T> {
  result?: { data?: T | { json?: T } };
  error?: { message?: string };
}

function unwrapTrpc<T>(env: TrpcEnvelope<T> | null): T | null {
  if (!env?.result?.data) return null;
  const data = env.result.data;
  if (data && typeof data === "object" && "json" in (data as object)) {
    return (data as { json?: T }).json ?? null;
  }
  return (data as T) ?? null;
}

async function podGet<T>(procedure: string, input: unknown = {}): Promise<T> {
  const enc = encodeURIComponent(JSON.stringify({ json: input }));
  const r = await fetch(`/api/pod/trpc/${procedure}?input=${enc}`, {
    credentials: "include",
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`Pod returned ${r.status}`);
  const env = (await r.json().catch(() => null)) as TrpcEnvelope<T> | null;
  if (env?.error?.message) throw new Error(env.error.message);
  const data = unwrapTrpc<T>(env);
  if (data === null || data === undefined) throw new Error("Empty pod response");
  return data;
}

async function podMutate<T>(procedure: string, input: unknown): Promise<T> {
  const r = await fetch(`/api/pod/trpc/${procedure}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ json: input }),
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`Pod returned ${r.status}`);
  const env = (await r.json().catch(() => null)) as TrpcEnvelope<T> | null;
  if (env?.error?.message) throw new Error(env.error.message);
  return (unwrapTrpc<T>(env) ?? ({} as T)) as T;
}

interface RealtimeCredentials {
  podUrl: string;
  realtimeUrl: string;
  apiKey: string;
}

export type ChatStatus =
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "error"; message: string };

export interface UseEveChatResult {
  messages: ChatMessage[];
  stream: StreamState | null;
  /** True while initial channel + history is being resolved. */
  isLoading: boolean;
  /** True between user send and assistant `complete`. */
  isSending: boolean;
  status: ChatStatus;
  channelId: string | null;
  sendMessage: (content: string) => Promise<void>;
}

function toIsoTimestamp(t: string | Date): string {
  if (t instanceof Date) return t.toISOString();
  return new Date(t).toISOString();
}

function normaliseMessage(m: PodMessage): ChatMessage {
  return {
    id: m.id,
    channelId: m.channelId,
    role: m.role,
    content: m.content,
    timestamp: toIsoTimestamp(m.timestamp),
  };
}

const PAGE_LIMIT = 50;

export function useEveChat(): UseEveChatResult {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [stream, setStream] = useState<StreamState | null>(null);
  const [channelId, setChannelId] = useState<string | null>(null);
  const [status, setStatus] = useState<ChatStatus>({ kind: "loading" });
  const [isSending, setIsSending] = useState(false);

  const socketRef = useRef<Socket | null>(null);
  const channelIdRef = useRef<string | null>(null);
  channelIdRef.current = channelId;

  // ─── Initial load: personal channel + history ──────────────────────
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // List personal threads. The pod scopes these to the caller via
        // protectedProcedure + userId in channels.listChannels.
        const list = await podGet<{ channels: PodChannel[] } | PodChannel[]>(
          "chat.listChannels",
          { channelType: "thread", threadKind: "personal", limit: 5 },
        );
        const items = Array.isArray(list)
          ? list
          : (list?.channels ?? []);
        if (cancelled) return;

        const personal = items[0];
        if (personal) {
          setChannelId(personal.id);
          const history = await podGet<{ messages: PodMessage[] }>(
            "chat.getMessages",
            { threadId: personal.id, limit: PAGE_LIMIT },
          );
          if (cancelled) return;
          // Backend returns newest-first; reverse to render oldest → newest.
          const rows = (history?.messages ?? [])
            .slice()
            .reverse()
            .map(normaliseMessage);
          setMessages(rows);
        }
        setStatus({ kind: "ready" });
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "unknown error";
        setStatus({ kind: "error", message });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // ─── Realtime: subscribe to chat:stream + chat:message ─────────────
  useEffect(() => {
    let cancelled = false;

    (async () => {
      let creds: RealtimeCredentials;
      try {
        const res = await fetch("/api/realtime/credentials", {
          credentials: "include",
          cache: "no-store",
        });
        if (!res.ok) return; // pod_not_paired = silently skip; REST path keeps working
        creds = (await res.json()) as RealtimeCredentials;
      } catch {
        return;
      }
      if (cancelled) return;

      const socket = io(creds.realtimeUrl, {
        path: "/socket.io/",
        transports: ["websocket", "polling"],
        auth: { apiKey: creds.apiKey },
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 8000,
      });
      socketRef.current = socket;

      socket.on("chat:stream", (payload: ChatStreamPayload) => {
        if (payload.threadId !== channelIdRef.current) return;
        if (payload.type === "chunk" && payload.content) {
          setStream((prev) => {
            const base =
              prev && prev.channelId === payload.threadId
                ? prev
                : { channelId: payload.threadId, content: "", isComplete: false };
            return { ...base, content: base.content + payload.content };
          });
        } else if (payload.type === "complete") {
          setStream((prev) =>
            prev && prev.channelId === payload.threadId
              ? { ...prev, isComplete: true }
              : prev,
          );
        }
      });

      socket.on("chat:message", (payload: ChatMessagePayload) => {
        if (payload.threadId !== channelIdRef.current) return;
        const m = payload.message;
        if (!m) return;
        setMessages((prev) => {
          if (prev.some((row) => row.id === m.id)) return prev;
          return [
            ...prev,
            {
              id: m.id,
              channelId: payload.threadId,
              role: m.role,
              content: m.content,
              timestamp: toIsoTimestamp(m.timestamp),
            },
          ];
        });
        // Assistant row landed — drop the stream buffer.
        setStream(null);
        setIsSending(false);
      });
    })();

    return () => {
      cancelled = true;
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, []);

  // ─── Send: optimistic user bubble + sendMessage tRPC mutation ──────
  const sendMessage = useCallback(
    async (content: string) => {
      const trimmed = content.trim();
      if (!trimmed || isSending) return;

      const optimisticId = `local-${Date.now()}`;
      const targetChannelId = channelIdRef.current;

      setIsSending(true);
      setMessages((prev) => [
        ...prev,
        {
          id: optimisticId,
          channelId: targetChannelId ?? "pending",
          role: "user",
          content: trimmed,
          timestamp: new Date().toISOString(),
        },
      ]);

      try {
        const result = await podMutate<{
          channelId: string;
          messageId: string;
          content: string;
        }>("chat.sendMessage", {
          ...(targetChannelId ? { channelId: targetChannelId } : {}),
          content: trimmed,
          aiChannelFamily: "agent",
        });

        if (!targetChannelId && result.channelId) {
          setChannelId(result.channelId);
        }
      } catch (err) {
        // Roll back the optimistic bubble and surface the error.
        setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
        setIsSending(false);
        const message = err instanceof Error ? err.message : "send failed";
        setStatus({ kind: "error", message });
      }
    },
    [isSending],
  );

  return {
    messages,
    stream,
    isLoading: status.kind === "loading",
    isSending,
    status,
    channelId,
    sendMessage,
  };
}
