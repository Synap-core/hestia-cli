"use client";

/**
 * `useEveChat` — native Synap chat plumbing for the Eve companion.
 *
 * Three responsibilities:
 *   1. Resolve a default channel id on mount via
 *      `chat.resolveOrCreateChannel` (V2 canonical, get-or-create) using
 *      the operator's active workspace. This mirrors the Relay pattern
 *      at `relay-app/src/hooks/useAIChat.ts` and guarantees
 *      `sendMessage` is always called with a `channelId`, eliminating
 *      the "workspaceId is required when sending a message without a
 *      thread" 400 from `chat.sendMessage`.
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
import { useActiveWorkspace } from "../../hooks/use-active-workspace";
import type {
  ChatMessage,
  ChatMessagePayload,
  ChatStreamPayload,
  PodAgent,
  PodChannel,
  PodIntelligenceService,
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

async function podGet<T>(
  procedure: string,
  input: unknown = {},
  workspaceId?: string | null,
): Promise<T> {
  const enc = encodeURIComponent(JSON.stringify({ json: input }));
  const headers: Record<string, string> = {};
  if (workspaceId) headers["x-workspace-id"] = workspaceId;
  const r = await fetch(`/api/pod/trpc/${procedure}?input=${enc}`, {
    credentials: "include",
    cache: "no-store",
    headers,
  });
  if (!r.ok) {
    // Surface the inner tRPC error message when available so callers can
    // render meaningful status text instead of the bare HTTP code.
    const env = (await r.json().catch(() => null)) as TrpcEnvelope<T> | null;
    const message = env?.error?.message ?? `Pod returned ${r.status}`;
    throw new Error(message);
  }
  const env = (await r.json().catch(() => null)) as TrpcEnvelope<T> | null;
  if (env?.error?.message) throw new Error(env.error.message);
  const data = unwrapTrpc<T>(env);
  if (data === null || data === undefined) throw new Error("Empty pod response");
  return data;
}

async function podMutate<T>(
  procedure: string,
  input: unknown,
  workspaceId?: string | null,
): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (workspaceId) headers["x-workspace-id"] = workspaceId;
  const r = await fetch(`/api/pod/trpc/${procedure}`, {
    method: "POST",
    credentials: "include",
    headers,
    body: JSON.stringify({ json: input }),
    cache: "no-store",
  });
  if (!r.ok) {
    const env = (await r.json().catch(() => null)) as TrpcEnvelope<T> | null;
    const message = env?.error?.message ?? `Pod returned ${r.status}`;
    throw new Error(message);
  }
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
  /**
   * Channel's default `assigned_agent_id` resolved at mount. Used by the
   * agent picker to label the "Default for this channel" row with the
   * actual agent name (resolved from `agents.workspaceList`).
   */
  channelAgentId: string | null;
  /**
   * User-picked agent slug for the next sendMessage. `null` ⇒ use the
   * channel's default agent (i.e. don't pass `agentHandle`).
   */
  selectedAgentSlug: string | null;
  setSelectedAgent: (slug: string | null) => void;
  sendMessage: (content: string) => Promise<void>;
  /**
   * Lazy-resolved id→display-name maps for the provenance badge under
   * assistant bubbles. Hydrated once when the first assistant message
   * with metadata lands; UUIDs missing from the map render as short
   * 6-char placeholders.
   */
  providerNames: Record<string, string>;
  agentNames: Record<string, string>;
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
    intelligenceServiceId: m.metadata?.intelligenceServiceId ?? null,
    agentId: m.metadata?.agentId ?? null,
  };
}

const PAGE_LIMIT = 50;
/**
 * Default agent slug for Eve's chat. "orchestrator" is the canonical
 * meta-agent in the backend (`agents` table seed). If the pod doesn't
 * have it the backend falls back to the next available agent — see
 * `resolveSlugToAgentId` in `synap-backend/packages/api/src/utils/
 * resolve-ai-channel-family.ts`.
 */
const DEFAULT_AGENT_SLUG = "orchestrator";

export function useEveChat(): UseEveChatResult {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [stream, setStream] = useState<StreamState | null>(null);
  const [channelId, setChannelId] = useState<string | null>(null);
  const [channelAgentId, setChannelAgentId] = useState<string | null>(null);
  const [status, setStatus] = useState<ChatStatus>({ kind: "loading" });
  const [isSending, setIsSending] = useState(false);
  // Internal counter so React re-renders when the per-channel map mutates.
  const [agentPickVersion, setAgentPickVersion] = useState(0);
  // Provenance display-name caches. Hydrated once on first message that
  // surfaces a non-null intelligenceServiceId or agentId.
  const [providerNames, setProviderNames] = useState<Record<string, string>>({});
  const [agentNames, setAgentNames] = useState<Record<string, string>>({});
  const provenanceHydratedRef = useRef(false);

  const { workspaceId, isLoading: workspaceLoading } = useActiveWorkspace();

  const socketRef = useRef<Socket | null>(null);
  const channelIdRef = useRef<string | null>(null);
  channelIdRef.current = channelId;
  const workspaceIdRef = useRef<string | null>(workspaceId);
  workspaceIdRef.current = workspaceId;
  // Per-channel agent override map. Survives composer re-mounts because
  // it lives on the hook instance; reset only when the operator picks a
  // different channel (Eve's chat companion is single-channel for now,
  // so in practice this is one entry).
  const agentByChannelRef = useRef<Map<string, string | null>>(new Map());
  void agentPickVersion;

  const selectedAgentSlug = channelId
    ? agentByChannelRef.current.get(channelId) ?? null
    : null;

  const setSelectedAgent = useCallback((slug: string | null) => {
    const cid = channelIdRef.current;
    if (!cid) return;
    if (slug === null) {
      agentByChannelRef.current.delete(cid);
    } else {
      agentByChannelRef.current.set(cid, slug);
    }
    setAgentPickVersion((n) => n + 1);
  }, []);

  // ─── Initial load: resolve agent channel + history ─────────────────
  useEffect(() => {
    // Wait until the active workspace has been resolved (or known absent).
    if (workspaceLoading) return;

    let cancelled = false;

    (async () => {
      try {
        if (!workspaceId) {
          if (cancelled) return;
          setStatus({ kind: "error", message: "Workspace not available" });
          return;
        }

        // Get-or-create the operator's personal AI channel via the V2
        // canonical procedure. `channelType: "personal"` returns one
        // channel per (userId, agent) — pod-wide, not scoped to a single
        // workspace, but the procedure requires a workspace header for
        // the protected context.
        const resolved = await podGet<{ channel: PodChannel }>(
          "chat.resolveOrCreateChannel",
          { workspaceId, channelType: "personal", agentSlug: DEFAULT_AGENT_SLUG },
          workspaceId,
        );
        if (cancelled) return;

        const resolvedChannel = resolved?.channel;
        if (!resolvedChannel?.id) {
          setStatus({
            kind: "error",
            message: "Channel resolution returned no channel",
          });
          return;
        }

        setChannelId(resolvedChannel.id);
        setChannelAgentId(resolvedChannel.assignedAgentId ?? null);

        const history = await podGet<{ messages: PodMessage[] }>(
          "chat.getMessages",
          { threadId: resolvedChannel.id, limit: PAGE_LIMIT },
          workspaceId,
        );
        if (cancelled) return;
        // Backend returns newest-first; reverse to render oldest → newest.
        const rows = (history?.messages ?? [])
          .slice()
          .reverse()
          .map(normaliseMessage);
        setMessages(rows);
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
  }, [workspaceId, workspaceLoading]);

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
        auth: { apiKey: creds.apiKey, workspaceId: workspaceIdRef.current ?? undefined },
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
              intelligenceServiceId: m.metadata?.intelligenceServiceId ?? null,
              agentId: m.metadata?.agentId ?? null,
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

      const targetChannelId = channelIdRef.current;
      if (!targetChannelId) {
        // The resolver hasn't finished yet (or it failed). Surface as a
        // status error rather than firing a request we know will 400.
        setStatus({ kind: "error", message: "Chat channel not ready" });
        return;
      }

      const optimisticId = `local-${Date.now()}`;
      setIsSending(true);
      setMessages((prev) => [
        ...prev,
        {
          id: optimisticId,
          channelId: targetChannelId,
          role: "user",
          content: trimmed,
          timestamp: new Date().toISOString(),
        },
      ]);

      try {
        // Read the picker's choice for this channel at send time so a
        // late pick (between optimistic insert and mutation dispatch)
        // still flows through.
        const pickedSlug = agentByChannelRef.current.get(targetChannelId) ?? null;
        const payload: {
          channelId: string;
          content: string;
          agentHandle?: string;
        } = {
          channelId: targetChannelId,
          content: trimmed,
        };
        if (pickedSlug) payload.agentHandle = pickedSlug;
        await podMutate<{
          channelId: string;
          messageId: string;
          content: string;
        }>("chat.sendMessage", payload, workspaceIdRef.current);
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

  // Hydrate provider + agent display-name maps once we have something to
  // resolve. Runs at most one fetch per hook instance.
  useEffect(() => {
    if (provenanceHydratedRef.current) return;
    const needsLookup = messages.some(
      (m) =>
        (m.intelligenceServiceId &&
          !providerNames[m.intelligenceServiceId]) ||
        (m.agentId && !agentNames[m.agentId]),
    );
    if (!needsLookup) return;
    provenanceHydratedRef.current = true;
    const ws = workspaceIdRef.current;

    void (async () => {
      // Pull both maps in parallel; ignore failures per-side.
      const [isResult, agentsResult] = await Promise.allSettled([
        podGet<{ services: PodIntelligenceService[] } | PodIntelligenceService[]>(
          "intelligenceRegistry.list",
          {},
          ws,
        ),
        podGet<{ agents: PodAgent[] } | PodAgent[]>(
          "agents.workspaceList",
          {},
          ws,
        ),
      ]);

      if (isResult.status === "fulfilled") {
        const list = Array.isArray(isResult.value)
          ? isResult.value
          : (isResult.value?.services ?? []);
        const map: Record<string, string> = {};
        for (const s of list) {
          if (s?.id && s.name) map[s.id] = s.name;
        }
        setProviderNames(map);
      }

      if (agentsResult.status === "fulfilled") {
        const list = Array.isArray(agentsResult.value)
          ? agentsResult.value
          : (agentsResult.value?.agents ?? []);
        const map: Record<string, string> = {};
        for (const a of list) {
          if (a?.id && a.name) map[a.id] = a.name;
        }
        setAgentNames(map);
      }
    })();
  }, [messages, providerNames, agentNames]);

  return {
    messages,
    stream,
    isLoading: status.kind === "loading",
    isSending,
    status,
    channelId,
    channelAgentId,
    selectedAgentSlug,
    setSelectedAgent,
    sendMessage,
    providerNames,
    agentNames,
  };
}
