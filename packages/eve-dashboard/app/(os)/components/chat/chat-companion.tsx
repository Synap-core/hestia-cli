"use client";

/**
 * `ChatCompanion` — Eve's AI chat body, now powered by `@synap-core/chat-ui`.
 *
 * The shell (`companion.tsx`) owns the header and slide-in animation.
 * This component renders the body: message list, streaming bubble, and
 * composer. All data plumbing lives in `useEveChat`.
 *
 * UI is delegated to `CompanionLayout` from `@synap-core/chat-ui`, themed
 * via CSS custom properties injected on the wrapper div (Eve dark glass palette).
 * The `AgentPicker` is rendered below `CompanionLayout` as a slot not
 * covered by the shared component.
 */

import { CompanionLayout } from "@synap-core/chat-ui";
import type { CompanionMessage } from "@synap-core/chat-ui";
import { useActiveWorkspace } from "../../hooks/use-active-workspace";
import { useEveChat } from "../../lib/chat/use-eve-chat";
import type { ChatMessage } from "../../lib/chat/types";
import { AgentPicker } from "./agent-picker";

function toCompanionMessage(msg: ChatMessage): CompanionMessage {
  return {
    id: msg.id,
    role: msg.role === "user" ? "user" : "assistant",
    content: msg.content ?? "",
    timestamp: new Date(msg.timestamp),
  };
}

export function ChatCompanion() {
  const {
    messages,
    stream,
    isLoading,
    isSending,
    channelAgentId,
    selectedAgentSlug,
    setSelectedAgent,
    sendMessage,
  } = useEveChat();
  const { workspaceId } = useActiveWorkspace();

  const isStreaming = !!stream && !stream.isComplete;
  const streamingContent = stream?.content ?? "";

  return (
    <div
      style={
        {
          "--companion-bg": "transparent",
          "--companion-surface": "rgba(255,255,255,0.06)",
          "--companion-surface-user": "rgba(255,255,255,0.10)",
          "--companion-text": "rgba(255,255,255,0.9)",
          "--companion-text-muted": "rgba(255,255,255,0.5)",
          "--companion-border": "rgba(255,255,255,0.10)",
          "--companion-border-subtle": "rgba(255,255,255,0.06)",
          "--companion-input-bg": "rgba(255,255,255,0.06)",
          "--companion-ai": "#10B981",
          "--companion-primary": "#22D3EE",
          "--companion-primary-light": "rgba(34,211,238,0.12)",
          "--companion-error": "#F43F5E",
          "--companion-radius": "16px",
          "--companion-radius-sm": "10px",
          "--companion-spacing": "4px",
          height: "100%",
          display: "flex",
          flexDirection: "column",
        } as React.CSSProperties
      }
    >
      <div style={{ flex: 1, minHeight: 0 }}>
        <CompanionLayout
          layout="panel"
          messages={messages.map(toCompanionMessage)}
          isLoading={isLoading || isSending && messages.length === 0}
          streamingContent={streamingContent}
          isStreaming={isStreaming}
          onSend={sendMessage}
          placeholder="Message Synap…"
        />
      </div>
      <div
        style={{
          flexShrink: 0,
          padding: "0 12px 10px",
          borderTop: "1px solid rgba(255,255,255,0.05)",
        }}
      >
        <AgentPicker
          workspaceId={workspaceId}
          selectedSlug={selectedAgentSlug}
          channelAgentId={channelAgentId}
          onChange={setSelectedAgent}
        />
      </div>
    </div>
  );
}
