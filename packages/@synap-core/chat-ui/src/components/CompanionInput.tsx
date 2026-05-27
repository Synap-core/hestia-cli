"use client";

import React, { useState, useCallback, useRef, useEffect } from "react";
import { Send, Square } from "lucide-react";
import { ContextChip } from "./ContextChip";
import type { ContextItem } from "./ContextChip";

// ─── Props ────────────────────────────────────────────────────────────────────

export interface CompanionInputProps {
  channelId?: string;
  value?: string;
  onChange?: (value: string) => void;
  onSend: (content: string, opts?: Record<string, unknown>) => void;
  placeholder?: string;
  disabled?: boolean;
  isLoading?: boolean;
  isStreaming?: boolean;
  onStop?: () => void;
  workspaceId?: string;
  /** Context items to show as chips inside the pill */
  contextItems?: ContextItem[];
  onRemoveContext?: (id: string) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Simplified companion chat input.
 * Pill-shaped input with context chips, auto-resizing textarea, send/stop button.
 * All styling via CSS custom properties — no Tamagui dependency.
 */
export function CompanionInput({
  value: externalValue,
  onChange: externalOnChange,
  onSend,
  placeholder = "Ask anything  ·  @ to attach",
  disabled = false,
  isLoading = false,
  isStreaming = false,
  onStop,
  contextItems = [],
  onRemoveContext,
}: CompanionInputProps) {
  const [internalValue, setInternalValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const value = externalValue ?? internalValue;
  const onChange = externalOnChange ?? setInternalValue;

  // ── Send ───────────────────────────────────────────────────────────────────

  const handleSend = useCallback(() => {
    if (!value.trim() || disabled || isLoading) return;
    onSend(value);
    onChange("");
  }, [value, disabled, isLoading, onSend, onChange]);

  // ── Keyboard ───────────────────────────────────────────────────────────────

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleSend();
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
        return;
      }
    },
    [handleSend]
  );

  // ── Auto-resize textarea ───────────────────────────────────────────────────

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 22), 200)}px`;
  }, [value]);

  // ── Render ─────────────────────────────────────────────────────────────────

  const hasChips = contextItems.length > 0;
  const canSend = value.trim() && !disabled && !isLoading;

  return (
    <div
      style={{
        width: "100%",
        backgroundColor: "var(--companion-bg)",
        paddingLeft: 12,
        paddingRight: 12,
        paddingTop: 8,
        paddingBottom: 8,
        borderTop: "1px solid var(--companion-border)",
      }}
    >
      <style>{`
        .companion-input-pill:focus-within {
          border-color: var(--companion-ai) !important;
        }
        .companion-input-pill textarea::placeholder {
          color: var(--companion-text-muted);
          opacity: 1;
        }
      `}</style>

      <div
        style={{
          maxWidth: 820,
          margin: "0 auto",
          width: "100%",
          position: "relative",
        }}
      >
        <div
          className="companion-input-pill"
          style={{
            border: "1px solid var(--companion-border)",
            borderRadius: 20,
            backgroundColor: "var(--companion-input-bg)",
            paddingLeft: 12,
            paddingRight: 8,
            paddingTop: 6,
            paddingBottom: 6,
            minHeight: 44,
            display: "flex",
            flexDirection: "column",
            transition: "border-color 150ms ease",
          }}
        >
          {/* Context chips row */}
          {hasChips && (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 4,
                alignItems: "center",
                paddingBottom: 4,
                paddingLeft: 2,
              }}
            >
              {contextItems.map((item) => (
                <ContextChip
                  key={item.objectId}
                  item={item}
                  onRemove={() => onRemoveContext?.(item.objectId)}
                />
              ))}
            </div>
          )}

          {/* Input row: textarea + send/stop */}
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "flex-end",
              gap: 6,
            }}
          >
            <textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              disabled={disabled}
              rows={1}
              style={{
                flex: 1,
                border: "none",
                outline: "none",
                background: "transparent",
                resize: "none",
                fontFamily: "inherit",
                fontSize: 14,
                lineHeight: "1.5",
                color: "var(--companion-text)",
                minHeight: 22,
                maxHeight: 200,
                overflow: "hidden",
                padding: 0,
                margin: 0,
                alignSelf: "center",
              }}
            />

            {/* Send / Stop button */}
            <div style={{ marginBottom: 2, flexShrink: 0 }}>
              {isStreaming ? (
                <button
                  onClick={onStop}
                  aria-label="Stop generating"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 28,
                    height: 28,
                    borderRadius: "50%",
                    border: "1px solid var(--companion-border)",
                    backgroundColor: "var(--companion-surface)",
                    cursor: "pointer",
                    color: "var(--companion-text)",
                    padding: 0,
                    transition: "background-color 120ms ease",
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.backgroundColor = "var(--companion-surface-user)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.backgroundColor = "var(--companion-surface)";
                  }}
                >
                  <Square size={13} fill="currentColor" />
                </button>
              ) : (
                <button
                  onClick={handleSend}
                  disabled={!canSend}
                  aria-label="Send message"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 28,
                    height: 28,
                    borderRadius: "50%",
                    border: canSend ? "none" : "1px solid var(--companion-border)",
                    backgroundColor: canSend ? "var(--companion-ai)" : "transparent",
                    cursor: canSend ? "pointer" : "not-allowed",
                    color: canSend ? "#fff" : "var(--companion-text-muted)",
                    padding: 0,
                    opacity: disabled || isLoading ? 0.5 : 1,
                    transition: "background-color 120ms ease, color 120ms ease",
                  }}
                >
                  <Send size={14} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
