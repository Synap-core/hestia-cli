"use client";

import React from "react";
import {
  CheckSquare,
  FileText,
  User,
  Calendar,
  Code,
  Building2,
  Bookmark,
  Layers,
  Box,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ContextItem {
  objectId: string;
  objectType: "entity" | "document" | "view";
  entityType?: string;
  label: string;
}

// ─── Icon / color resolution ─────────────────────────────────────────────────

const ENTITY_ICONS: Record<string, LucideIcon> = {
  task: CheckSquare,
  note: FileText,
  person: User,
  event: Calendar,
  code: Code,
  company: Building2,
  bookmark: Bookmark,
};

function resolveIcon(item: ContextItem): LucideIcon {
  if (item.objectType === "document") return FileText;
  if (item.objectType === "view") return Layers;
  return ENTITY_ICONS[item.entityType ?? ""] ?? Box;
}

function accentColor(item: ContextItem): string {
  if (item.objectType === "view") return "var(--companion-ai)";
  return "var(--companion-primary)";
}

// ─── Component ────────────────────────────────────────────────────────────────

export interface ContextChipProps {
  item: ContextItem;
  onRemove: () => void;
}

/**
 * Micro inline chip for context items — sits inside the input pill.
 * Color-coded dot + icon + truncated label + dismiss.
 */
export function ContextChip({ item, onRemove }: ContextChipProps) {
  const Icon = resolveIcon(item);
  const accent = accentColor(item);

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        height: 22,
        padding: "0 6px",
        borderRadius: 6,
        backgroundColor: "var(--companion-surface)",
        border: "1px solid var(--companion-border-subtle)",
        fontSize: 12,
        fontWeight: 500,
        color: "var(--companion-text)",
        whiteSpace: "nowrap",
        maxWidth: 160,
        flexShrink: 0,
        userSelect: "none",
        transition: "background-color 120ms ease",
      }}
      title={item.label}
    >
      {/* Color-coded accent dot */}
      <span
        style={{
          width: 4,
          height: 4,
          borderRadius: 2,
          backgroundColor: accent,
          flexShrink: 0,
        }}
      />
      <Icon size={11} strokeWidth={2} color={accent} style={{ flexShrink: 0 }} />
      <span
        style={{
          overflow: "hidden",
          textOverflow: "ellipsis",
          minWidth: 0,
        }}
      >
        {item.label}
      </span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        aria-label={`Remove ${item.label}`}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: 0,
          opacity: 0.4,
          flexShrink: 0,
          borderRadius: 3,
          color: "var(--companion-text)",
          transition: "opacity 120ms",
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.opacity = "0.9"; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.opacity = "0.4"; }}
      >
        <X size={10} strokeWidth={2.5} />
      </button>
    </span>
  );
}
