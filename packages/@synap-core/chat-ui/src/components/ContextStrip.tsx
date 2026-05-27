"use client";

import React from "react";
import { ContextChip } from "./ContextChip";
import type { ContextItem } from "./ContextChip";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ContextStripItem {
  id: string;
  label: string;
  type: "entity" | "view" | "doc";
}

export interface ContextStripProps {
  items: ContextStripItem[];
  onRemove?: (id: string) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Shows active context above the input before the user types.
 * Only renders if items.length > 0.
 */
export function ContextStrip({ items, onRemove }: ContextStripProps) {
  if (items.length === 0) return null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 6,
        padding: "6px 12px",
        borderTop: "1px solid var(--companion-border-subtle)",
      }}
    >
      <span
        style={{
          fontSize: 11,
          color: "var(--companion-text-muted)",
          whiteSpace: "nowrap",
          flexShrink: 0,
        }}
      >
        Seeing:
      </span>
      {items.map((item) => {
        // Map ContextStripItem → ContextItem shape
        const contextItem: ContextItem = {
          objectId: item.id,
          objectType: item.type === "doc" ? "document" : item.type === "view" ? "view" : "entity",
          label: item.label,
        };
        return (
          <ContextChip
            key={item.id}
            item={contextItem}
            onRemove={() => onRemove?.(item.id)}
          />
        );
      })}
    </div>
  );
}
