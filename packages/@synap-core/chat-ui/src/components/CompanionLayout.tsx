"use client";

/**
 * CompanionLayout
 *
 * Plain-CSS layout component for the AI companion panel.
 * No Tamagui, no HeroUI — styled exclusively via --companion-* CSS tokens.
 *
 * Layout modes:
 *   'panel'  — narrow side/companion panel (displayMode='medium')
 *   'full'   — full-width content area (displayMode='full')
 */

import React, { useRef, useState, useCallback, useEffect } from "react";
import type { ReactNode, FormEvent, KeyboardEvent } from "react";
import { StreamDots } from "./StreamDots";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CompanionMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

export interface CompanionLayoutProps {
  /** Layout mode derived from displayMode */
  layout: "panel" | "full";

  /** Messages to display */
  messages: CompanionMessage[];

  /** Whether the initial thread is loading */
  isLoading?: boolean;

  /** Streaming content (partial AI response) */
  streamingContent?: string;

  /** Whether an AI response is currently streaming */
  isStreaming?: boolean;

  /** Context labels shown as chips above the input */
  contextItems?: string[];

  /** Called when the user submits a message */
  onSend: (content: string) => void | Promise<void>;

  /** Called when the user wants to abort streaming */
  onStop?: () => void;

  /** Extra content rendered below the last message (proposals, steps, etc.) */
  renderAfterContent?: () => ReactNode;

  /** Called when the user clicks an entity link inside a message */
  onEntityLinkClick?: (entityId: string) => void;

  /** Placeholder text for the input */
  placeholder?: string;

  /** Pre-fill the composer with this text (e.g. from Cmd+J query bar) */
  initialDraft?: string;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function MessageBubble({
  message,
  onEntityLinkClick,
}: {
  message: CompanionMessage;
  onEntityLinkClick?: (entityId: string) => void;
}) {
  const isUser = message.role === "user";

  // Simple entity-link detection: [[entity:id|label]] syntax
  const renderContent = useCallback(
    (text: string): ReactNode => {
      const parts = text.split(/(\[\[entity:[^\]]+\]\])/g);
      return parts.map((part, i) => {
        const match = part.match(/^\[\[entity:([^|]+)(?:\|([^\]]+))?\]\]$/);
        if (match) {
          const entityId = match[1]!;
          const label = match[2] ?? entityId;
          return (
            <button
              key={i}
              type="button"
              onClick={() => onEntityLinkClick?.(entityId)}
              style={{
                color: "var(--companion-ai)",
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: 0,
                font: "inherit",
                textDecoration: "underline",
              }}
            >
              {label}
            </button>
          );
        }
        return <span key={i}>{part}</span>;
      });
    },
    [onEntityLinkClick]
  );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: isUser ? "flex-end" : "flex-start",
        gap: "var(--companion-spacing)",
        paddingLeft: isUser ? "20%" : 0,
        paddingRight: isUser ? 0 : "20%",
      }}
    >
      <div
        style={{
          backgroundColor: isUser
            ? "var(--companion-surface-user)"
            : "var(--companion-surface)",
          color: "var(--companion-text)",
          borderRadius: isUser
            ? "var(--companion-radius) var(--companion-radius-sm) var(--companion-radius-sm) var(--companion-radius)"
            : "var(--companion-radius-sm) var(--companion-radius) var(--companion-radius) var(--companion-radius-sm)",
          padding: "10px 14px",
          fontSize: 13,
          lineHeight: 1.55,
          border: "1px solid var(--companion-border-subtle)",
          wordBreak: "break-word",
          whiteSpace: "pre-wrap",
        }}
      >
        {renderContent(message.content)}
      </div>
    </div>
  );
}

function StreamingBubble({ content }: { content: string }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        paddingRight: "20%",
      }}
    >
      <div
        style={{
          backgroundColor: "var(--companion-surface)",
          color: "var(--companion-text)",
          borderRadius:
            "var(--companion-radius-sm) var(--companion-radius) var(--companion-radius) var(--companion-radius-sm)",
          padding: "10px 14px",
          fontSize: 13,
          lineHeight: 1.55,
          border: "1px solid var(--companion-border-subtle)",
          wordBreak: "break-word",
          whiteSpace: "pre-wrap",
          minWidth: 40,
        }}
      >
        {content || <StreamDots size="sm" />}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        opacity: 0.4,
        userSelect: "none",
      }}
    >
      <svg
        width="28"
        height="28"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--companion-ai)"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 2a10 10 0 1 0 10 10" />
        <path d="M12 8v4l3 3" />
        <circle cx="18" cy="6" r="3" fill="var(--companion-ai)" stroke="none" />
      </svg>
      <span
        style={{
          fontSize: 12,
          color: "var(--companion-text-muted)",
          textAlign: "center",
        }}
      >
        Ask me anything
      </span>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function CompanionLayout({
  layout,
  messages,
  isLoading = false,
  streamingContent = "",
  isStreaming = false,
  contextItems = [],
  onSend,
  onStop,
  renderAfterContent,
  onEntityLinkClick,
  placeholder = "Ask anything…",
  initialDraft,
}: CompanionLayoutProps) {
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Pre-fill composer when a pending query is passed in (e.g. from Cmd+J bar)
  useEffect(() => {
    if (initialDraft) {
      setDraft(initialDraft);
      textareaRef.current?.focus();
    }
  }, [initialDraft]);

  // Auto-scroll to bottom when messages or streaming content changes
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, streamingContent]);

  const handleSend = useCallback(async () => {
    const content = draft.trim();
    if (!content || isSending || isStreaming) return;
    setDraft("");
    setIsSending(true);
    try {
      await onSend(content);
    } finally {
      setIsSending(false);
      textareaRef.current?.focus();
    }
  }, [draft, isSending, isStreaming, onSend]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void handleSend();
      }
    },
    [handleSend]
  );

  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      void handleSend();
    },
    [handleSend]
  );

  // Auto-resize textarea
  const handleTextareaChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setDraft(e.target.value);
      const el = e.target;
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
    },
    []
  );

  const showEmpty = messages.length === 0 && !isStreaming && !isLoading;
  const isPanelLayout = layout === "panel";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
        fontSize: isPanelLayout ? 13 : 14,
      }}
    >
      {/* Messages area */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: isPanelLayout ? "12px 12px 8px" : "20px 24px 12px",
          display: "flex",
          flexDirection: "column",
          gap: 8,
          scrollbarWidth: "none",
        }}
      >
        {isLoading ? (
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <StreamDots size="sm" />
          </div>
        ) : showEmpty ? (
          <EmptyState />
        ) : (
          <>
            {messages.map((msg) => (
              <MessageBubble
                key={msg.id}
                message={msg}
                onEntityLinkClick={onEntityLinkClick}
              />
            ))}
            {isStreaming && <StreamingBubble content={streamingContent} />}
            {renderAfterContent?.()}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Context chips */}
      {contextItems.length > 0 && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 4,
            padding: isPanelLayout ? "0 12px 6px" : "0 24px 8px",
          }}
        >
          {contextItems.map((label, i) => (
            <span
              key={`${label}-${i}`}
              style={{
                fontSize: 11,
                padding: "2px 8px",
                borderRadius: "var(--companion-radius-sm)",
                backgroundColor: "var(--companion-primary-light)",
                color: "var(--companion-primary)",
                border: "1px solid var(--companion-border-subtle)",
                whiteSpace: "nowrap",
                maxWidth: 160,
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {label}
            </span>
          ))}
        </div>
      )}

      {/* Input area */}
      <form
        onSubmit={handleSubmit}
        style={{
          padding: isPanelLayout ? "0 12px 12px" : "0 24px 20px",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            gap: 6,
            backgroundColor: "var(--companion-input-bg)",
            border: "1px solid var(--companion-border)",
            borderRadius: "var(--companion-radius)",
            padding: "8px 10px",
            transition: "border-color 0.15s",
          }}
          onFocus={(e) => {
            (e.currentTarget as HTMLDivElement).style.borderColor =
              "var(--companion-border-subtle)";
          }}
        >
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={handleTextareaChange}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            rows={1}
            style={{
              flex: 1,
              background: "none",
              border: "none",
              outline: "none",
              color: "var(--companion-text)",
              fontSize: "inherit",
              lineHeight: 1.5,
              resize: "none",
              minHeight: 22,
              maxHeight: 120,
              fontFamily: "inherit",
            }}
          />
          {isStreaming && onStop ? (
            <button
              type="button"
              onClick={onStop}
              title="Stop"
              style={{
                flexShrink: 0,
                width: 28,
                height: 28,
                borderRadius: "var(--companion-radius-sm)",
                backgroundColor: "var(--companion-error)",
                border: "none",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#fff",
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              ■
            </button>
          ) : (
            <button
              type="submit"
              disabled={!draft.trim() || isSending || isStreaming}
              title="Send (Enter)"
              style={{
                flexShrink: 0,
                width: 28,
                height: 28,
                borderRadius: "var(--companion-radius-sm)",
                backgroundColor:
                  draft.trim() && !isSending && !isStreaming
                    ? "var(--companion-primary)"
                    : "var(--companion-surface)",
                border: "none",
                cursor:
                  draft.trim() && !isSending && !isStreaming
                    ? "pointer"
                    : "default",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color:
                  draft.trim() && !isSending && !isStreaming
                    ? "#fff"
                    : "var(--companion-text-muted)",
                transition: "background-color 0.15s",
                opacity: isSending ? 0.6 : 1,
              }}
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          )}
        </div>
        {!isPanelLayout && (
          <p
            style={{
              fontSize: 11,
              color: "var(--companion-text-muted)",
              margin: "4px 2px 0",
              opacity: 0.7,
            }}
          >
            Enter to send · Shift+Enter for new line
          </p>
        )}
      </form>
    </div>
  );
}
