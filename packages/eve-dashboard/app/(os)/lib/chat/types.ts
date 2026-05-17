/**
 * Native Eve chat types. Shapes mirror the Synap backend's `messages`
 * table and the `chat:stream` / `chat:message` realtime events emitted
 * by `synap-backend/packages/api/src/routers/channels.ts` (sendMessage).
 *
 * We intentionally keep this surface tiny — the chat companion only
 * cares about a handful of fields. The Synap pod is the source of
 * truth; nothing here is persisted in Eve.
 */

export type ChatRole = "user" | "assistant" | "system";

/**
 * One message in the chat panel. `id` matches `messages.id` from the
 * pod; we identify streaming bubbles by `channelId` + the assistant's
 * pending state instead of a temporary id.
 */
export interface ChatMessage {
  id: string;
  channelId: string;
  role: ChatRole;
  content: string;
  /** ISO-8601 string. The pod returns a Date; we serialise on receive. */
  timestamp: string;
}

/**
 * Per-channel streaming state. The backend emits `chat:stream` chunks
 * for the in-flight assistant response, then a `chat:message` for the
 * finalised row. We accumulate `content` until `isComplete = true`.
 */
export interface StreamState {
  channelId: string;
  content: string;
  /** Inflated when the assistant message has been persisted by the pod. */
  isComplete: boolean;
}

/**
 * Wire shape of a `chat:stream` event payload. Matches the
 * `emitChatEvent({ event: EventNames.CHAT_STREAM, data: … })` calls
 * inside `channels.ts::sendMessage`.
 */
export interface ChatStreamPayload {
  threadId: string;
  type: "chunk" | "complete";
  content?: string;
  isComplete?: boolean;
  agentType?: string;
}

/**
 * Wire shape of a `chat:message` event payload — the finalised
 * assistant message persisted to the pod.
 */
export interface ChatMessagePayload {
  threadId: string;
  message: {
    id: string;
    threadId: string;
    role: ChatRole;
    content: string;
    userId: string;
    timestamp: string | Date;
  };
  userId: string;
}

/** Pod listChannels item — narrow subset Eve actually reads. */
export interface PodChannel {
  id: string;
  channelType: string;
  threadKind: string | null;
  title: string | null;
  userId: string;
  workspaceId: string | null;
}

/** Pod getMessages return shape — narrow subset. */
export interface PodMessage {
  id: string;
  channelId: string;
  role: ChatRole;
  content: string;
  timestamp: string | Date;
}
