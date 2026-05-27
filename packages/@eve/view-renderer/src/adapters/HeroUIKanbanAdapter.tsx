"use client";

/**
 * HeroUIKanbanAdapter
 *
 * Groups entities by their `dealStage` (or generic `status`) property into
 * draggable kanban columns. Mirrors the deal-pipeline board in the CRM app
 * but accepts generic ViewAdapterProps so it works for any entity profile.
 */

import React, { useState } from "react";
import type { ViewAdapterProps, Entity } from "../types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getGroupKey(entity: Entity): string {
  const props = entity.properties ?? {};
  return (
    (props.dealStage as string | undefined) ??
    (props.status as string | undefined) ??
    "other"
  );
}

function formatValue(value: unknown): string | null {
  const n = Number(value);
  if (!value || isNaN(n)) return null;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}k`;
  return `$${n}`;
}

function staleDays(entity: Entity): number {
  if (!entity.updatedAt) return 0;
  return (Date.now() - new Date(entity.updatedAt as string).getTime()) / 86_400_000;
}

// ─── Card ─────────────────────────────────────────────────────────────────────

function KanbanCard({
  entity,
  onEntityClick,
}: {
  entity: Entity;
  onEntityClick?: (id: string) => void;
}) {
  const props = entity.properties ?? {};
  const value = formatValue(props.value);
  const owner = props.owner as string | undefined;
  const days = staleDays(entity);
  const isStuck = days >= 14;

  return (
    <div
      onClick={() => onEntityClick?.(entity.id)}
      className="bg-content1 border border-divider rounded-lg p-3 flex flex-col gap-1.5 cursor-pointer hover:border-foreground/15 hover:bg-content2 transition-colors select-none"
    >
      <div className="flex items-start gap-2">
        {isStuck && (
          <span
            className="mt-1 w-1.5 h-1.5 rounded-full shrink-0 bg-amber-400"
            title="Deal may be stuck"
          />
        )}
        <p className="text-sm font-medium text-foreground truncate flex-1">
          {entity.title ?? "Untitled"}
        </p>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {owner && (
          <span className="text-[10px] text-foreground/40 truncate">{owner}</span>
        )}
        {value && (
          <span className="text-[10px] text-foreground/50">{value}</span>
        )}
        {days > 0 && (
          <span
            className={`text-[10px] tabular-nums ${
              isStuck ? "text-amber-400" : "text-foreground/25"
            }`}
          >
            {Math.floor(days)}d
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Column ───────────────────────────────────────────────────────────────────

function KanbanColumn({
  label,
  entities,
  isOver,
  onEntityClick,
  onDragOver,
  onDrop,
  onDragLeave,
}: {
  label: string;
  entities: Entity[];
  isOver: boolean;
  onEntityClick?: (id: string) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onDragLeave: () => void;
}) {
  const totalValue = entities.reduce((sum, e) => {
    const v = Number(e.properties?.value ?? 0);
    return sum + (isNaN(v) ? 0 : v);
  }, 0);
  const valueLabel = formatValue(totalValue);

  return (
    <div
      className="flex flex-col shrink-0"
      style={{ minWidth: 260, maxWidth: 300, width: 280 }}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragLeave={onDragLeave}
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-2 px-1">
        <span className="text-xs font-medium text-foreground/70 truncate flex-1">
          {label}
        </span>
        <span className="text-xs text-foreground/30 tabular-nums shrink-0">
          {entities.length}
          {valueLabel ? ` · ${valueLabel}` : ""}
        </span>
      </div>

      {/* Cards */}
      <div
        className={`flex-1 overflow-y-auto rounded-lg transition-colors flex flex-col gap-2 p-1 ${
          isOver ? "bg-primary/5 ring-1 ring-primary/20" : ""
        }`}
      >
        {entities.length === 0 && !isOver && (
          <p className="text-xs text-foreground/20 text-center pt-4 px-2">
            No items
          </p>
        )}
        {entities.map((entity) => (
          <div
            key={entity.id}
            draggable
            onDragStart={(e) => e.dataTransfer.setData("entityId", entity.id)}
          >
            <KanbanCard entity={entity} onEntityClick={onEntityClick} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

export function HeroUIKanbanAdapter({
  entities,
  config,
  onEntityClick,
}: ViewAdapterProps) {
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);

  // Build ordered column list from config or derive from data
  const configColumns = (config.render as Record<string, unknown> | undefined)
    ?.columns as string[] | undefined;

  const groupKeys = configColumns?.length
    ? configColumns
    : Array.from(new Set(entities.map(getGroupKey)));

  // Map entities into columns
  const byGroup = new Map<string, Entity[]>();
  for (const key of groupKeys) byGroup.set(key, []);
  for (const entity of entities) {
    const key = getGroupKey(entity);
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key)!.push(entity);
  }

  function handleDragOver(e: React.DragEvent, col: string) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverColumn(col);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOverColumn(null);
    // Drop handling is intentionally a no-op here — the adapter is read-only.
    // The host page owns mutation logic (useDealActions etc).
  }

  return (
    <div className="flex gap-3 h-full p-4 overflow-x-auto">
      {groupKeys.map((col) => (
        <KanbanColumn
          key={col}
          label={col.charAt(0).toUpperCase() + col.slice(1)}
          entities={byGroup.get(col) ?? []}
          isOver={dragOverColumn === col}
          onEntityClick={onEntityClick}
          onDragOver={(e) => handleDragOver(e, col)}
          onDrop={handleDrop}
          onDragLeave={() => {
            if (dragOverColumn === col) setDragOverColumn(null);
          }}
        />
      ))}
    </div>
  );
}
