"use client";

import React, { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { MessageBubble } from "./MessageBubble";
import { StreamDots } from "./StreamDots";
import type { GroupPosition } from "./MessageBubble";
import type { EntityLinkType } from "./MessageContent";
import type { ChatMessage } from "@synap-core/types";

// ---------------------------------------------------------------------------
// CompactionBreak — session memory separator
// ---------------------------------------------------------------------------

const COMPACTION_PHRASES = [
  "organized its memory between sessions",
  "tidied up its notes",
  "caught up on everything",
  "compressed the archives, nothing lost",
  "refreshed its context",
  "stretched its memory, ready to go",
];

function CompactionBreak({ index = 0 }: { index?: number }) {
  const phrase = COMPACTION_PHRASES[index % COMPACTION_PHRASES.length];
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        padding: "14px 0 6px",
        animation: "companionCompactSlide 6s ease forwards",
      }}
    >
      <style>{`
        @keyframes companionCompactSlide {
          0%   { opacity: 0; transform: translateY(4px); }
          12%  { opacity: 1; transform: translateY(0); }
          80%  { opacity: 1; transform: translateY(0); }
          100% { opacity: 0.28; transform: translateY(0); }
        }
      `}</style>
      <div
        style={{
          width: 20,
          height: 1,
          backgroundColor: "var(--companion-border-subtle)",
        }}
      />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          padding: "4px 12px",
          borderRadius: 999,
          border: "1px solid var(--companion-border-subtle)",
          backgroundColor: "var(--companion-surface)",
        }}
      >
        <span style={{ fontSize: 9, opacity: 0.4, lineHeight: 1 }}>✦</span>
        <span
          style={{
            fontSize: 11,
            color: "var(--companion-text-muted)",
            fontStyle: "italic",
            fontFamily: "inherit",
            whiteSpace: "nowrap",
          }}
        >
          Synap {phrase}
        </span>
      </div>
      <div
        style={{
          width: 20,
          height: 1,
          backgroundColor: "var(--companion-border-subtle)",
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Session helpers
// ---------------------------------------------------------------------------

function getSessionId(msg: ChatMessage): string | null | undefined {
  const m = msg as ChatMessage & { sessionId?: string | null };
  return m.sessionId ?? null;
}

function findCurrentSessionId(messages: ChatMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const sid = getSessionId(messages[i]);
    if (sid) return sid;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Grouping helpers
// ---------------------------------------------------------------------------

const GROUP_THRESHOLD_MS = 5 * 60 * 1000;

function getSenderId(msg: ChatMessage): string {
  return msg.userId || msg.role;
}

function withinThreshold(a: ChatMessage, b: ChatMessage): boolean {
  return (
    Math.abs(
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    ) < GROUP_THRESHOLD_MS
  );
}

function computeGroupPositions(messages: ChatMessage[]): GroupPosition[] {
  return messages.map((msg, i) => {
    const prev = i > 0 ? messages[i - 1] : null;
    const next = i < messages.length - 1 ? messages[i + 1] : null;

    const sameAsPrev =
      prev &&
      getSenderId(prev) === getSenderId(msg) &&
      withinThreshold(prev, msg);

    const sameAsNext =
      next &&
      getSenderId(next) === getSenderId(msg) &&
      withinThreshold(msg, next);

    if (sameAsPrev && sameAsNext) return "middle";
    if (sameAsPrev && !sameAsNext) return "last";
    if (!sameAsPrev && sameAsNext) return "first";
    return "single";
  });
}

// ---------------------------------------------------------------------------
// Date separator helpers
// ---------------------------------------------------------------------------

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatDateLabel(date: Date): string {
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(date, now)) return "Today";
  if (isSameDay(date, yesterday)) return "Yesterday";
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function DateSeparator({ date }: { date: Date }) {
  const label = formatDateLabel(date);
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingTop: 12,
        paddingBottom: 12,
        paddingLeft: 8,
        paddingRight: 8,
      }}
    >
      <div
        style={{
          flex: 1,
          height: 1,
          backgroundColor: "var(--companion-border-subtle)",
          opacity: 0.4,
        }}
      />
      <span
        style={{
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: 0.6,
          color: "var(--companion-text-muted)",
          opacity: 0.55,
          textTransform: "uppercase",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
      <div
        style={{
          flex: 1,
          height: 1,
          backgroundColor: "var(--companion-border-subtle)",
          opacity: 0.4,
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Multi-AI agent color palette
// ---------------------------------------------------------------------------

const AGENT_COLOR_PALETTE = [
  "#10B981", // emerald (primary AI)
  "#0891B2", // cyan
  "#8B5CF6", // violet
  "#F43F5E", // rose
  "#F59E0B", // amber
];

function hashToIndex(str: string, length: number): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) & 0xffffffff;
  }
  return Math.abs(hash) % length;
}

function buildAgentColorMap(messages: ChatMessage[]): Map<string, string> {
  const aiUserIds = new Set<string>();
  for (const msg of messages) {
    if (msg.role === "assistant" && msg.userId) {
      aiUserIds.add(msg.userId);
    }
  }
  const map = new Map<string, string>();
  const ids = Array.from(aiUserIds);
  ids.forEach((id) => {
    const color =
      ids.length <= 1
        ? AGENT_COLOR_PALETTE[0]
        : AGENT_COLOR_PALETTE[hashToIndex(id, AGENT_COLOR_PALETTE.length)];
    map.set(id, color);
  });
  return map;
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function MessageSkeleton() {
  const skeletonItems = [
    { width: "62%", align: "flex-start" as const, lines: 2 },
    { width: "48%", align: "flex-end" as const, lines: 1 },
    { width: "70%", align: "flex-start" as const, lines: 3 },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, paddingTop: 8 }}>
      {skeletonItems.map((s, i) => (
        <div
          key={i}
          style={{
            alignSelf: s.align,
            width: s.width,
            display: "flex",
            flexDirection: "column",
            gap: 6,
            opacity: 1 - i * 0.15,
          }}
        >
          {Array.from({ length: s.lines }).map((_, li) => (
            <div
              key={li}
              style={{
                height: li === s.lines - 1 && s.lines > 1 ? 10 : 13,
                width: li === s.lines - 1 && s.lines > 1 ? "70%" : "100%",
                borderRadius: 8,
                backgroundColor: "var(--companion-surface)",
                border: "1px solid var(--companion-border-subtle)",
              }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface MessageListProps {
  messages: ChatMessage[];
  isLoading?: boolean;
  streamingMessage?: {
    messageId: string;
    channelId: string;
    content: string;
    startedAt: Date;
    isComplete: boolean;
    steps?: unknown[];
  };
  /** Rendered BEFORE the message text — thinking steps for AI messages. */
  renderBeforeContent?: (message: ChatMessage) => React.ReactNode;
  /** Optional: render extra content (proposals, entities) per message. */
  renderExtraContent?: (message: ChatMessage) => React.ReactNode;
  onApproveProposal?: (id: string, comment?: string) => void;
  onRejectProposal?: (id: string, reason?: string) => void;
  onCopyMessage?: (message: ChatMessage) => void;
  onBranchFromMessage?: (message: ChatMessage) => void;
  onEditMessage?: (message: ChatMessage) => void;
  onRegenerateMessage?: (message: ChatMessage) => void;
  onSaveMessage?: (message: ChatMessage) => void;
  fetchNextPage?: () => void;
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  /** Show a "thinking" indicator while waiting for the first AI response chunk. */
  showThinkingIndicator?: boolean;
  onEntityLinkClick?: (id: string, type: EntityLinkType) => void;
  /** When set, the message with this ID gets a soft highlight glow that auto-fades. */
  highlightedMessageId?: string | null;
  /** Max number of messages to render (for compact/panel modes). Default 100. */
  messageLimit?: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const DEFAULT_MESSAGE_LIMIT = 100;

/**
 * Scrollable list of chat messages with:
 * - Message grouping (consecutive same-sender within 5 min → clustered bubbles)
 * - Date separators between day boundaries
 * - Multi-AI agent color differentiation
 * - Session compaction breaks
 */
export function MessageList({
  messages,
  isLoading = false,
  streamingMessage,
  showThinkingIndicator = false,
  renderBeforeContent,
  renderExtraContent,
  onApproveProposal: _onApproveProposal,
  onRejectProposal: _onRejectProposal,
  onCopyMessage,
  onBranchFromMessage,
  onSaveMessage,
  onEditMessage,
  onRegenerateMessage,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  onEntityLinkClick,
  highlightedMessageId,
  messageLimit = DEFAULT_MESSAGE_LIMIT,
}: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  const [visibleCount, setVisibleCount] = useState(messageLimit);
  const displayMessages =
    messages.length <= visibleCount
      ? messages
      : messages.slice(-visibleCount);
  const hasMoreToShow = messages.length > visibleCount;
  const showLoadOlder = hasMoreToShow || (hasNextPage ?? false);

  useEffect(() => {
    if (messages.length <= messageLimit) {
      setVisibleCount(messageLimit);
    }
  }, [messages.length, messageLimit]);

  const handleLoadOlder = () => {
    if (hasMoreToShow) {
      setVisibleCount((prev: number) => Math.min(prev + 50, messages.length));
    } else if (hasNextPage && fetchNextPage) {
      fetchNextPage();
    }
  };

  // Snap to bottom on discrete events
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ block: "end", behavior: "auto" });
    });
    return () => cancelAnimationFrame(raf);
  }, [messages.length, showThinkingIndicator]);

  // Smooth follow during active streaming
  const isStreamingActive = !!streamingMessage && !streamingMessage.isComplete;
  useEffect(() => {
    if (!isStreamingActive) return;
    bottomRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [streamingMessage?.content, isStreamingActive]);

  const groupPositions = computeGroupPositions(displayMessages);
  const agentColorMap = buildAgentColorMap(displayMessages);

  // Session tracking
  const currentSessionId = findCurrentSessionId(displayMessages);
  const sessionBreakIndices = new Map<number, number>();
  {
    let lastSid: string | null | undefined = undefined;
    let breakCount = 0;
    displayMessages.forEach((msg, i) => {
      const sid = getSessionId(msg);
      if (i > 0 && lastSid != null && sid != null && sid !== lastSid) {
        sessionBreakIndices.set(i, breakCount++);
      }
      if (sid != null) lastSid = sid;
    });
  }

  // Build the streaming pseudo-message
  const streamingPseudoMessage: ChatMessage | null =
    streamingMessage && !streamingMessage.isComplete
      ? ({
          id: streamingMessage.messageId,
          channelId: streamingMessage.channelId,
          role: "assistant",
          content: streamingMessage.content,
          userId: "",
          timestamp: streamingMessage.startedAt,
          metadata: streamingMessage.steps
            ? { aiSteps: streamingMessage.steps }
            : null,
          deletedAt: null,
          parentId: null,
          previousHash: null,
          hash: "",
        } as ChatMessage)
      : null;

  return (
    <div
      style={{
        overflowY: "auto",
        flex: 1,
        padding: "16px",
        display: "flex",
        flexDirection: "column",
        paddingBottom: 100,
      }}
    >
      {isLoading && messages.length === 0 ? (
        <MessageSkeleton />
      ) : !isLoading && messages.length === 0 && !showThinkingIndicator && !streamingPseudoMessage ? (
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            padding: 32,
            minHeight: 240,
          }}
        >
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: "50%",
              backgroundColor: "var(--companion-surface)",
              border: "1px solid var(--companion-border-subtle)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <span style={{ fontSize: 20 }}>✦</span>
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 4,
            }}
          >
            <span
              style={{
                fontSize: 15,
                fontWeight: 600,
                color: "var(--companion-text)",
              }}
            >
              Start the conversation
            </span>
            <span
              style={{
                fontSize: 13,
                color: "var(--companion-text-muted)",
                textAlign: "center",
                opacity: 0.7,
              }}
            >
              Ask anything, explore ideas, or let Synap take the lead.
            </span>
          </div>
        </div>
      ) : (
        <>
          {/* Load older */}
          {showLoadOlder && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 12,
                borderBottom: "1px solid var(--companion-border-subtle)",
              }}
            >
              <button
                onClick={handleLoadOlder}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  paddingLeft: 12,
                  paddingRight: 12,
                  paddingTop: 6,
                  paddingBottom: 6,
                  borderRadius: 8,
                  border: "none",
                  background: "none",
                  cursor: "pointer",
                  fontSize: 13,
                  color: "var(--companion-text-muted)",
                  transition: "background-color 120ms ease",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.backgroundColor = "var(--companion-surface)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.backgroundColor = "transparent";
                }}
              >
                {isFetchingNextPage
                  ? "Loading…"
                  : hasMoreToShow
                    ? `Show ${Math.min(50, messages.length - visibleCount)} older messages`
                    : "Load older messages"}
              </button>
            </div>
          )}

          {displayMessages.map((message, i) => {
            const prev: ChatMessage | null = i > 0 ? displayMessages[i - 1] : null;
            const needsDateSep =
              prev !== null &&
              !isSameDay(new Date(prev.timestamp), new Date(message.timestamp));
            const needsFirstDateSep = i === 0;

            const agentColor =
              message.role === "assistant" && message.userId
                ? agentColorMap.get(message.userId)
                : undefined;

            const thisSessionId = getSessionId(message);
            const sessionBreakPhraseIndex = sessionBreakIndices.get(i);
            const isSessionBreak = sessionBreakPhraseIndex !== undefined;

            const isPreviousSession =
              currentSessionId != null &&
              thisSessionId != null &&
              thisSessionId !== currentSessionId;

            return (
              <React.Fragment key={message.id}>
                {isSessionBreak && (
                  <CompactionBreak index={sessionBreakPhraseIndex} />
                )}
                {(needsFirstDateSep || needsDateSep) && (
                  <DateSeparator date={new Date(message.timestamp)} />
                )}
                <div
                  data-message-id={message.id}
                  style={{
                    opacity: isPreviousSession ? 0.45 : 1,
                    transition: "opacity 200ms",
                    display: "flex",
                    flexDirection: "column",
                    position: "relative",
                  }}
                >
                  {/* Highlight glow */}
                  {highlightedMessageId === message.id && (
                    <motion.div
                      initial={{ opacity: 1 }}
                      animate={{ opacity: 0 }}
                      transition={{ duration: 2.2, ease: "easeOut" }}
                      style={{
                        position: "absolute",
                        inset: -4,
                        borderRadius: 16,
                        backgroundColor: "color-mix(in srgb, var(--companion-ai) 10%, transparent)",
                        pointerEvents: "none",
                        zIndex: 0,
                      }}
                    />
                  )}
                  <MessageBubble
                    message={message}
                    groupPosition={groupPositions[i]}
                    agentColor={agentColor}
                    isStreaming={streamingMessage?.messageId === message.id}
                    renderBeforeContent={renderBeforeContent?.(message)}
                    renderAfterContent={renderExtraContent?.(message)}
                    onCopyMessage={onCopyMessage}
                    onBranchFromMessage={onBranchFromMessage}
                    onSaveMessage={onSaveMessage}
                    onEditMessage={onEditMessage}
                    onRegenerateMessage={onRegenerateMessage}
                    onEntityLinkClick={onEntityLinkClick}
                  />
                </div>
              </React.Fragment>
            );
          })}
        </>
      )}

      {/* In-flight streaming message */}
      {streamingPseudoMessage && (
        <MessageBubble
          message={streamingPseudoMessage}
          groupPosition="single"
          isStreaming={true}
          renderBeforeContent={renderBeforeContent?.(streamingPseudoMessage)}
          renderAfterContent={renderExtraContent?.(streamingPseudoMessage)}
          onCopyMessage={onCopyMessage}
          onBranchFromMessage={onBranchFromMessage}
          onEditMessage={onEditMessage}
          onRegenerateMessage={onRegenerateMessage}
          onEntityLinkClick={onEntityLinkClick}
        />
      )}

      {/* Fetching more pages skeleton */}
      {isFetchingNextPage && (
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            padding: 12,
          }}
        >
          <div style={{ width: 24, height: 8, borderRadius: 4, backgroundColor: "var(--companion-surface)" }} />
          <div style={{ width: 40, height: 8, borderRadius: 4, backgroundColor: "var(--companion-surface)", opacity: 0.6 }} />
          <div style={{ width: 24, height: 8, borderRadius: 4, backgroundColor: "var(--companion-surface)", opacity: 0.3 }} />
        </div>
      )}

      {/* Thinking indicator */}
      {showThinkingIndicator && !streamingPseudoMessage && (
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            paddingLeft: 12,
            paddingRight: 12,
            paddingTop: 8,
            paddingBottom: 8,
          }}
        >
          <StreamDots size="sm" />
          <span
            style={{
              fontSize: 13,
              color: "var(--companion-text-muted)",
              opacity: 0.6,
            }}
          >
            Thinking…
          </span>
        </div>
      )}

      {/* Scroll anchor */}
      <div ref={bottomRef} style={{ height: 1 }} />
    </div>
  );
}
