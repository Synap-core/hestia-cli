"use client";

import React, { useState, useCallback, useRef } from "react";
import { motion } from "framer-motion";
import { Copy, Check, GitBranch, RefreshCw, Pin, Pencil } from "lucide-react";
import { MessageContent } from "./MessageContent";
import { StreamDots } from "./StreamDots";
import type { EntityLinkType } from "./MessageContent";
import type { ChatMessage } from "@synap-core/types";

export type { EntityLinkType };

// ─── Types ────────────────────────────────────────────────────────────────────

export type GroupPosition = "single" | "first" | "middle" | "last";

export interface MessageBubbleProps {
  message: ChatMessage;
  isStreaming?: boolean;
  /** Rendered BEFORE the message text — used for AI thinking steps. */
  renderBeforeContent?: React.ReactNode;
  /** Optional slot for AI-specific content (entities, proposals). Rendered after the message content. */
  renderAfterContent?: React.ReactNode;
  /** Message action callbacks (floating bar on hover). */
  onCopyMessage?: (message: ChatMessage) => void;
  onBranchFromMessage?: (message: ChatMessage) => void;
  onEditMessage?: (message: ChatMessage) => void;
  onRegenerateMessage?: (message: ChatMessage) => void;
  /** Save AI message content as a Note to the library */
  onSaveMessage?: (message: ChatMessage) => void;
  /** Override author type (defaults to inferring from message.role) */
  authorType?: "human" | "ai_agent" | "external" | "bot";
  /** Message category for compact rendering */
  messageCategory?: "chat" | "comment" | "review" | "system_notification";
  /** Compact mode: smaller, no timestamp row, used for inline comments */
  compact?: boolean;
  /**
   * Position in a consecutive same-sender group.
   * Drives border-radius clustering, badge/timestamp visibility, and gap compression.
   */
  groupPosition?: GroupPosition;
  /**
   * Optional accent color override — used for multi-AI conversations where
   * each agent gets a distinct identity color.
   */
  agentColor?: string;
  /** Called when the user clicks an [[entity:ID:Name]] inline reference link in AI prose. */
  onEntityLinkClick?: (id: string, type: EntityLinkType) => void;
}

// ─── AgentOrb ─────────────────────────────────────────────────────────────────

const AgentOrb = ({ color }: { color?: string }) => (
  <div
    style={{
      width: 20,
      height: 20,
      borderRadius: "50%",
      background: color ?? "var(--companion-ai)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flexShrink: 0,
    }}
  >
    <span style={{ fontSize: 9, color: "#fff" }}>✦</span>
  </div>
);

// ─── MessageActions ───────────────────────────────────────────────────────────

interface MessageActionsProps {
  message: ChatMessage;
  isUser: boolean;
  isStreaming?: boolean;
  visible?: boolean;
  inline?: boolean;
  onCopy?: (message: ChatMessage) => void;
  onBranch?: (message: ChatMessage) => void;
  onEdit?: (message: ChatMessage) => void;
  onRegenerate?: (message: ChatMessage) => void;
  onSaveToLibrary?: (message: ChatMessage) => void;
}

function MessageActions({
  message,
  isUser,
  isStreaming = false,
  visible = false,
  inline = false,
  onCopy,
  onBranch,
  onEdit,
  onRegenerate,
  onSaveToLibrary,
}: MessageActionsProps) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const handleCopy = useCallback(() => {
    if (!onCopy) return;
    onCopy(message);
    setCopied(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(false), 1800);
  }, [onCopy, message]);

  const btnStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 28,
    height: 28,
    borderRadius: "50%",
    border: "none",
    background: "none",
    cursor: "pointer",
    color: "var(--companion-text-muted)",
    padding: 0,
    transition: "background-color 150ms ease, color 150ms ease",
    flexShrink: 0,
  };

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 2,
        paddingTop: inline ? 0 : 8,
        marginTop: inline ? 0 : 4,
        paddingBottom: inline ? 0 : 3,
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? "auto" : "none",
        transition: "opacity 120ms ease",
        alignSelf: isUser ? "flex-end" : "flex-start",
      }}
    >
      {onCopy && (
        <button
          style={{
            ...btnStyle,
            ...(copied
              ? { backgroundColor: "color-mix(in srgb, var(--companion-ai) 10%, transparent)", color: "var(--companion-ai)" }
              : {}),
          }}
          onClick={handleCopy}
          aria-label={copied ? "Copied!" : "Copy message"}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "var(--companion-surface)"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = copied ? "color-mix(in srgb, var(--companion-ai) 10%, transparent)" : "transparent"; }}
        >
          {copied ? <Check size={14} strokeWidth={2.5} /> : <Copy size={14} />}
        </button>
      )}
      {isUser ? (
        <>
          {onEdit && (
            <button
              style={btnStyle}
              onClick={() => onEdit(message)}
              aria-label="Edit message"
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "var(--companion-surface)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "transparent"; }}
            >
              <Pencil size={14} />
            </button>
          )}
        </>
      ) : (
        <>
          {onRegenerate && !isStreaming && (
            <button
              style={btnStyle}
              onClick={() => onRegenerate(message)}
              aria-label="Regenerate response"
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "var(--companion-surface)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "transparent"; }}
            >
              <RefreshCw size={14} />
            </button>
          )}
          {onBranch && (
            <button
              style={btnStyle}
              onClick={() => onBranch(message)}
              aria-label="Branch from here"
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "var(--companion-surface)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "transparent"; }}
            >
              <GitBranch size={14} />
            </button>
          )}
          {onSaveToLibrary && (
            <button
              style={btnStyle}
              onClick={() => onSaveToLibrary(message)}
              aria-label="Pin as anchor"
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "var(--companion-surface)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "transparent"; }}
            >
              <Pin size={14} />
            </button>
          )}
        </>
      )}
    </div>
  );
}

// ─── MessageBubble ────────────────────────────────────────────────────────────

/**
 * Message bubble for chat. Supports AI, human, external, and bot author types.
 * Compact mode renders inline comments without timestamp or action bar.
 * renderAfterContent slot is used to inject AI steps and proposals.
 * groupPosition drives visual clustering of consecutive same-sender messages.
 */
export function MessageBubble({
  message,
  isStreaming = false,
  renderBeforeContent,
  renderAfterContent,
  onCopyMessage,
  onBranchFromMessage,
  onEditMessage,
  onRegenerateMessage,
  onSaveMessage,
  authorType: authorTypeProp,
  messageCategory,
  compact = false,
  groupPosition = "single",
  agentColor,
  onEntityLinkClick,
}: MessageBubbleProps) {
  const isUser = message.role === "user";
  const [hovered, setHovered] = useState(false);

  // Extract file attachments from message metadata
  const typedMetadata = message.metadata as {
    attachments?: Array<{
      entityId: string;
      fileName: string;
      mimeType: string;
      size?: number;
      previewUrl?: string;
    }>;
    forwarded?: boolean;
    sourceChannelId?: string;
    sourceChannelName?: string;
  } | null;
  const attachments = typedMetadata?.attachments;
  const isForwarded = typedMetadata?.forwarded === true;
  const forwardedSourceName = typedMetadata?.sourceChannelName;

  // Determine author type
  const authorType =
    authorTypeProp ??
    (message as { authorType?: "human" | "ai_agent" | "external" | "bot" }).authorType ??
    (isUser ? "human" : "ai_agent");

  const isAI = authorType === "ai_agent";
  const isExternal = authorType === "external";
  const isComment =
    messageCategory === "comment" || messageCategory === "review";

  const hasActions =
    !compact &&
    (onCopyMessage ||
      onBranchFromMessage ||
      onEditMessage ||
      (onRegenerateMessage && !isUser));

  // Group-position derived display flags
  const showBadge =
    !compact && (groupPosition === "single" || groupPosition === "first");
  const showTimestamp =
    !compact && (groupPosition === "single" || groupPosition === "last");

  const accentColor = agentColor ?? "var(--companion-ai)";

  // Background/border styling based on author type
  const bubbleBg = isForwarded
    ? "var(--companion-surface)"
    : isUser && !isExternal
      ? "var(--companion-surface-user)"
      : "var(--companion-surface)";

  const bubbleBorderColor = isUser && !isExternal
    ? "var(--companion-border)"
    : "var(--companion-border-subtle)";

  // Border radius clustering
  const FULL = 20;
  const NOTCH = 4;
  const COMPACT = 12;

  const getGroupRadii = (): React.CSSProperties => {
    if (compact) {
      return {
        borderTopLeftRadius: COMPACT,
        borderTopRightRadius: COMPACT,
        borderBottomLeftRadius: COMPACT,
        borderBottomRightRadius: COMPACT,
      };
    }
    if (isUser) {
      // User bubbles: notch on top-right
      return {
        borderTopLeftRadius: FULL,
        borderBottomLeftRadius: FULL,
        borderTopRightRadius: groupPosition === "first" || groupPosition === "single" ? NOTCH : FULL,
        borderBottomRightRadius: groupPosition === "last" || groupPosition === "single" ? NOTCH : FULL,
      };
    }
    // AI/external bubbles: notch on top-left
    return {
      borderTopLeftRadius: groupPosition === "first" || groupPosition === "single" ? NOTCH : FULL,
      borderBottomLeftRadius: groupPosition === "last" || groupPosition === "single" ? NOTCH : FULL,
      borderTopRightRadius: FULL,
      borderBottomRightRadius: FULL,
    };
  };

  const groupRadii = getGroupRadii();

  const outerMarginBottom = compact
    ? 2
    : groupPosition === "single" || groupPosition === "last"
      ? 24
      : 3;

  const timestampStyle: React.CSSProperties = {
    fontSize: 11,
    color: "var(--companion-text-muted)",
    opacity: 0.6,
  };

  // ── AI messages: flat rendering, no bubble card ──────────────────────────
  if (isAI && !compact) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", damping: 28, stiffness: 320 }}
        style={{
          alignSelf: "flex-start",
          maxWidth: "82%",
          width: "100%",
          position: "relative",
          marginBottom: outerMarginBottom,
          zIndex: hovered ? 10 : "auto",
        }}
        onMouseEnter={() => hasActions && setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {showBadge && (
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              paddingLeft: 4,
              paddingRight: 4,
              marginBottom: 8,
            }}
          >
            <AgentOrb color={accentColor} />
          </div>
        )}

        {renderBeforeContent}

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            paddingLeft: 4,
            paddingRight: 4,
            marginTop: renderBeforeContent ? 8 : undefined,
          }}
        >
          {isStreaming && !message.content ? (
            <StreamDots size="sm" />
          ) : (
            <MessageContent
              content={message.content}
              isStreaming={isStreaming}
              format="markdown"
              onEntityLinkClick={onEntityLinkClick}
              attachments={attachments}
            />
          )}

          {renderAfterContent}
        </div>

        {showTimestamp && (
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              paddingLeft: 4,
              paddingRight: 4,
              marginTop: 4,
            }}
          >
            <span style={timestampStyle}>
              {new Date(message.timestamp).toLocaleTimeString(undefined, {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            {hasActions && (
              <MessageActions
                message={message}
                isUser={false}
                isStreaming={isStreaming}
                visible={hovered}
                inline
                onCopy={onCopyMessage}
                onBranch={onBranchFromMessage}
                onRegenerate={onRegenerateMessage}
                onSaveToLibrary={onSaveMessage}
              />
            )}
          </div>
        )}

        {!showTimestamp && hasActions && (
          <div
            style={{
              position: "absolute",
              top: "100%",
              marginTop: 2,
              left: 4,
              zIndex: 10,
              pointerEvents: hovered ? "auto" : "none",
            }}
          >
            <MessageActions
              message={message}
              isUser={false}
              isStreaming={isStreaming}
              visible={hovered}
              inline
              onCopy={onCopyMessage}
              onBranch={onBranchFromMessage}
              onRegenerate={onRegenerateMessage}
            />
          </div>
        )}
      </motion.div>
    );
  }

  // ── User / external / compact messages: bubble card ──────────────────────
  return (
    <motion.div
      initial={{ opacity: 0, y: 6, x: isUser ? 8 : -8 }}
      animate={{ opacity: 1, y: 0, x: 0 }}
      transition={{ type: "spring", damping: 24, stiffness: 300 }}
      style={{
        alignSelf: isUser ? "flex-end" : "flex-start",
        width: compact ? "100%" : isUser ? "fit-content" : "100%",
        maxWidth: compact ? "100%" : isAI ? "82%" : "75%",
        marginLeft: isUser && !compact ? "auto" : undefined,
        position: "relative",
        marginBottom: outerMarginBottom,
        zIndex: hovered ? 10 : "auto",
      }}
      onMouseEnter={() => hasActions && setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Author badge row — only for first/single in group, non-user */}
      {showBadge && !isUser && (
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            paddingLeft: 8,
            paddingRight: 8,
            marginBottom: 4,
          }}
        >
          <AgentOrb color={accentColor} />
        </div>
      )}

      {/* Bubble */}
      <div
        style={{
          padding: compact ? "8px 12px" : "12px 16px",
          backgroundColor: bubbleBg,
          border: `1px solid ${bubbleBorderColor}`,
          borderLeftWidth: isForwarded ? 3 : 1,
          borderLeftColor: isForwarded ? "var(--companion-text-muted)" : bubbleBorderColor,
          ...groupRadii,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Forwarded message header */}
        {isForwarded && (
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              marginBottom: 6,
            }}
          >
            <span
              style={{
                fontSize: 11,
                color: "var(--companion-text-muted)",
                fontStyle: "italic",
              }}
            >
              {"Forwarded from " + (forwardedSourceName || "another conversation")}
            </span>
          </div>
        )}

        {/* Compact comment header: author badge inline */}
        {compact && (isExternal || authorType === "bot") && (
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              marginBottom: 4,
            }}
          >
            <AgentOrb color={accentColor} />
          </div>
        )}

        {isStreaming && !message.content ? (
          <StreamDots size="sm" />
        ) : (
          <MessageContent
            content={message.content}
            isStreaming={isStreaming}
            format={isComment ? "plain" : "markdown"}
            onEntityLinkClick={onEntityLinkClick}
            attachments={attachments}
          />
        )}
        {renderAfterContent}
      </div>

      {/* Bottom row: timestamp (single/last) + actions */}
      {showTimestamp && (
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            justifyContent: isUser ? "flex-end" : "flex-start",
            gap: 8,
            paddingLeft: 8,
            paddingRight: 8,
            marginTop: 4,
          }}
        >
          <span style={timestampStyle}>
            {new Date(message.timestamp).toLocaleTimeString(undefined, {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
          {isUser && hasActions && (
            <MessageActions
              message={message}
              isUser={isUser}
              isStreaming={isStreaming}
              visible={hovered}
              inline
              onCopy={onCopyMessage}
              onBranch={onBranchFromMessage}
              onEdit={onEditMessage}
              onRegenerate={onRegenerateMessage}
            />
          )}
        </div>
      )}

      {/* Actions for first/middle user messages — absolute, no layout impact */}
      {!showTimestamp && isUser && hasActions && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            marginTop: 2,
            right: 0,
            zIndex: 10,
            pointerEvents: hovered ? "auto" : "none",
          }}
        >
          <MessageActions
            message={message}
            isUser={isUser}
            isStreaming={isStreaming}
            visible={hovered}
            inline
            onCopy={onCopyMessage}
            onBranch={onBranchFromMessage}
            onEdit={onEditMessage}
            onRegenerate={onRegenerateMessage}
          />
        </div>
      )}
    </motion.div>
  );
}
