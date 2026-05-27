"use client";

/**
 * HeroUITableAdapter
 *
 * Renders entities as a sortable data table. Column set is derived from the
 * first entity's properties (or from config.render.columns if provided).
 * Mirrors the companies/contacts table views in the CRM app.
 */

import React, { useMemo, useState } from "react";
import { ChevronUp, ChevronDown } from "lucide-react";
import type { ViewAdapterProps, Entity } from "../types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ALWAYS_FIRST = ["title", "name", "id"];
const ALWAYS_LAST = ["id", "createdAt", "updatedAt"];
const SKIP_KEYS = new Set(["__typename"]);

function deriveColumns(entities: Entity[], configCols?: string[]): string[] {
  if (configCols?.length) return configCols;

  const keySet = new Set<string>(["title"]);
  for (const e of entities.slice(0, 10)) {
    for (const k of Object.keys(e.properties ?? {})) {
      if (!SKIP_KEYS.has(k)) keySet.add(k);
    }
  }

  return Array.from(keySet).sort((a, b) => {
    const ai = ALWAYS_FIRST.indexOf(a);
    const bi = ALWAYS_FIRST.indexOf(b);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    const al = ALWAYS_LAST.indexOf(a);
    const bl = ALWAYS_LAST.indexOf(b);
    if (al !== -1 && bl !== -1) return al - bl;
    if (al !== -1) return 1;
    if (bl !== -1) return -1;
    return a.localeCompare(b);
  });
}

function getCellValue(entity: Entity, col: string): unknown {
  if (col === "title") return entity.title ?? "";
  return entity.properties?.[col];
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return value.toLocaleString();
  if (value instanceof Date) return value.toLocaleDateString();
  if (typeof value === "string") {
    // ISO date heuristic
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
      try {
        return new Date(value).toLocaleDateString();
      } catch {
        return value;
      }
    }
    return value;
  }
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

function colLabel(col: string): string {
  return col
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (s) => s.toUpperCase())
    .trim();
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

export function HeroUITableAdapter({
  entities,
  config,
  onEntityClick,
}: ViewAdapterProps) {
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const configCols = (config.render as Record<string, unknown> | undefined)
    ?.columns as string[] | undefined;

  const columns = useMemo(
    () => deriveColumns(entities, configCols),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entities.length, configCols?.join(",")],
  );

  const sorted = useMemo(() => {
    if (!sortCol) return entities;
    return [...entities].sort((a, b) => {
      const av = String(getCellValue(a, sortCol) ?? "");
      const bv = String(getCellValue(b, sortCol) ?? "");
      const cmp = av.localeCompare(bv, undefined, { numeric: true });
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [entities, sortCol, sortDir]);

  function toggleSort(col: string) {
    if (sortCol === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(col);
      setSortDir("asc");
    }
  }

  if (entities.length === 0) {
    return (
      <div className="flex items-center justify-center h-32">
        <p className="text-sm text-foreground/30">No items</p>
      </div>
    );
  }

  // Limit to first 8 columns to keep the table readable
  const visibleCols = columns.slice(0, 8);

  return (
    <div className="overflow-auto w-full h-full">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-divider bg-content1 sticky top-0 z-10">
            {visibleCols.map((col) => (
              <th
                key={col}
                onClick={() => toggleSort(col)}
                className="text-left px-4 py-2.5 text-xs font-medium text-foreground/50 cursor-pointer hover:text-foreground/80 whitespace-nowrap select-none"
              >
                <div className="flex items-center gap-1">
                  {colLabel(col)}
                  {sortCol === col ? (
                    sortDir === "asc" ? (
                      <ChevronUp size={11} />
                    ) : (
                      <ChevronDown size={11} />
                    )
                  ) : null}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((entity) => (
            <tr
              key={entity.id}
              onClick={() => onEntityClick?.(entity.id)}
              className="border-b border-divider last:border-0 cursor-pointer hover:bg-content1 transition-colors"
            >
              {visibleCols.map((col) => (
                <td
                  key={col}
                  className="px-4 py-2.5 text-xs text-foreground/70 whitespace-nowrap max-w-48 truncate"
                >
                  {formatCell(getCellValue(entity, col))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
