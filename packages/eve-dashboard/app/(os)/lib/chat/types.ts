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
  /**
   * Provenance — populated for assistant messages. UUID of the
   * IntelligenceService that produced the response. Rendered as a small
   * "Provider · Agent" badge under the bubble. Missing on user messages
   * and on assistant rows written before this field was introduced.
   */
  intelligenceServiceId?: string | null;
  /** UUID of the agent that produced this message. Pairs with the IS id above. */
  agentId?: string | null;
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
    metadata?: PodMessageMetadata | null;
  };
  userId: string;
}

/**
 * Subset of `ConversationMessageMetadata` Eve cares about. Mirrors the
 * fields populated by the backend in `channels.ts::sendMessage` on the
 * assistant row insert.
 */
export interface PodMessageMetadata {
  intelligenceServiceId?: string;
  agentId?: string;
}

/** Pod listChannels item — narrow subset Eve actually reads. */
export interface PodChannel {
  id: string;
  channelType: string;
  title: string | null;
  userId: string;
  workspaceId: string | null;
  /**
   * Channel's default agent — set when the personal channel was resolved via
   * `chat.resolveOrCreateChannel({ channelType: "personal", agentSlug })`.
   * The picker uses this to show the channel's default agent name when
   * nothing is explicitly picked.
   */
  assignedAgentId?: string | null;
}

/**
 * One row returned by `agents.workspaceList`. Mirrors the `agents` table
 * (`synap-backend/packages/database/src/schema/agents.ts`). Eve only
 * needs the identity + categorisation fields.
 */
export interface PodAgent {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  ownerType: "system" | "user" | "provider";
  intelligenceServiceId?: string | null;
  active?: boolean | null;
}

/** Pod getMessages return shape — narrow subset. */
export interface PodMessage {
  id: string;
  channelId: string;
  role: ChatRole;
  content: string;
  timestamp: string | Date;
  metadata?: PodMessageMetadata | null;
}

/** Subset of an IntelligenceService row from `intelligenceRegistry.list`. */
export interface PodIntelligenceService {
  id: string;
  serviceId?: string | null;
  name: string;
}
