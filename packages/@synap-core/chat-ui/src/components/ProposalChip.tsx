"use client";

import React, { useState } from "react";
import { Check, X, ChevronRight } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ProposalChipProps {
  title: string;
  changeCount?: number;
  status: "pending" | "approved" | "rejected";
  onApprove?: () => void;
  onReject?: () => void;
  /** Opens full card in side panel */
  onExpand?: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Collapsed-first proposal chip.
 * Single line: title + "N changes" + ✓ ✗ buttons.
 * Full card = side panel responsibility — this chip is chat-only.
 */
export function ProposalChip({
  title,
  changeCount,
  status,
  onApprove,
  onReject,
  onExpand,
}: ProposalChipProps) {
  const [hovered, setHovered] = useState(false);

  const statusColor =
    status === "approved"
      ? "var(--companion-ai)"
      : status === "rejected"
        ? "var(--companion-error)"
        : "var(--companion-border)";

  const statusBg =
    status === "approved"
      ? "color-mix(in srgb, var(--companion-ai) 10%, transparent)"
      : status === "rejected"
        ? "color-mix(in srgb, var(--companion-error) 10%, transparent)"
        : "var(--companion-surface)";

  const actionBtnStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 22,
    height: 22,
    borderRadius: "50%",
    border: "none",
    background: "none",
    cursor: "pointer",
    padding: 0,
    flexShrink: 0,
    transition: "background-color 120ms ease",
  };

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "5px 8px 5px 10px",
        borderRadius: "var(--companion-radius-sm)",
        border: `1px solid ${statusColor}`,
        backgroundColor: statusBg,
        fontSize: 12,
        color: "var(--companion-text)",
        maxWidth: "100%",
        transition: "border-color 150ms ease, background-color 150ms ease",
        cursor: onExpand ? "pointer" : "default",
        userSelect: "none",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onExpand}
    >
      {/* Status indicator dot */}
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          backgroundColor: statusColor,
          flexShrink: 0,
        }}
      />

      {/* Title */}
      <span
        style={{
          flex: 1,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          minWidth: 0,
          fontWeight: 500,
        }}
      >
        {title}
      </span>

      {/* Change count badge */}
      {changeCount != null && changeCount > 0 && (
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            color: "var(--companion-text-muted)",
            backgroundColor: "var(--companion-surface)",
            border: "1px solid var(--companion-border-subtle)",
            borderRadius: 4,
            padding: "1px 5px",
            flexShrink: 0,
            whiteSpace: "nowrap",
          }}
        >
          {changeCount} {changeCount === 1 ? "change" : "changes"}
        </span>
      )}

      {/* Expand chevron */}
      {onExpand && (
        <ChevronRight
          size={12}
          style={{
            flexShrink: 0,
            color: "var(--companion-text-muted)",
            opacity: hovered ? 0.9 : 0.4,
            transition: "opacity 120ms",
          }}
        />
      )}

      {/* Action buttons — only shown when pending */}
      {status === "pending" && (onApprove || onReject) && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 2,
            flexShrink: 0,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {onApprove && (
            <button
              style={actionBtnStyle}
              aria-label="Approve"
              onClick={(e) => {
                e.stopPropagation();
                onApprove();
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.backgroundColor =
                  "color-mix(in srgb, var(--companion-ai) 15%, transparent)";
                (e.currentTarget as HTMLElement).style.color = "var(--companion-ai)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.backgroundColor = "transparent";
                (e.currentTarget as HTMLElement).style.color = "var(--companion-text-muted)";
              }}
            >
              <Check size={12} strokeWidth={2.5} color="var(--companion-ai)" />
            </button>
          )}
          {onReject && (
            <button
              style={actionBtnStyle}
              aria-label="Reject"
              onClick={(e) => {
                e.stopPropagation();
                onReject();
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.backgroundColor =
                  "color-mix(in srgb, var(--companion-error) 15%, transparent)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.backgroundColor = "transparent";
              }}
            >
              <X size={12} strokeWidth={2.5} color="var(--companion-error)" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
