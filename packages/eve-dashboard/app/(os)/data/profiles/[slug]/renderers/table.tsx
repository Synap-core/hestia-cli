"use client";

/**
 * `TableRenderer` — Eve OS's built-in list-slot table renderer.
 *
 * Registered against `cellKey: 'table'`. Auto-detects columns from the
 * union of entity property keys (capped to keep the table readable).
 *
 * When the resolver eventually returns richer config (e.g. `props.columns`
 * with explicit ordering + display names), this renderer will honor it.
 * For Phase 1 it auto-detects from the data shape.
 */

import { useMemo } from "react";
import { Card, CardBody } from "@heroui/react";

import type { EveListRendererProps } from "../types";

const MAX_COLUMNS = 6;

export function TableRenderer({
  entities,
  onOpenEntity,
}: EveListRendererProps) {
  const columns = useMemo(() => {
    const keys = new Set<string>();
    for (const e of entities) {
      if (e.properties) {
        for (const k of Object.keys(e.properties)) {
          keys.add(k);
        }
      }
    }
    return Array.from(keys).slice(0, MAX_COLUMNS);
  }, [entities]);

  return (
    <div className="flex-1 overflow-auto animate-pane-content-in">
      <div className="mx-auto max-w-[1400px] px-5 py-6 sm:py-8">
        <Card shadow="none" className="bg-content1 border border-divider">
          <CardBody className="p-0 overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-widest text-default-400 border-b border-divider">
                  <th className="px-3 py-2 font-medium">Title</th>
                  {columns.map((c) => (
                    <th key={c} className="px-3 py-2 font-medium">
                      {humanize(c)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {entities.length === 0 ? (
                  <tr>
                    <td
                      colSpan={columns.length + 1}
                      className="py-8 text-center text-default-500"
                    >
                      No entities.
                    </td>
                  </tr>
                ) : (
                  entities.map((e) => (
                    <tr
                      key={e.id}
                      onClick={() => onOpenEntity(e.id)}
                      className="border-b border-divider hover:bg-default-100 cursor-pointer transition-colors"
                    >
                      <td className="px-3 py-2 text-foreground font-medium truncate max-w-[260px]">
                        {e.title ?? "Untitled"}
                      </td>
                      {columns.map((c) => (
                        <td
                          key={c}
                          className="px-3 py-2 text-default-500 truncate max-w-[200px]"
                        >
                          {formatCell(e.properties?.[c])}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </CardBody>
        </Card>
      </div>
      <RendererAttribution cellKey="table" />
    </div>
  );
}

function formatCell(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "string") return v;
  if (typeof v === "number") return v.toLocaleString();
  if (typeof v === "boolean") return v ? "✓" : "—";
  if (Array.isArray(v)) return v.map(String).join(", ");
  return JSON.stringify(v);
}

function humanize(s: string): string {
  return s.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function RendererAttribution({ cellKey }: { cellKey: string }) {
  return (
    <div className="pointer-events-none fixed bottom-3 right-3 z-10">
      <Card
        shadow="none"
        className="border border-divider bg-content1/80 backdrop-blur-sm"
      >
        <CardBody className="px-2.5 py-1">
          <p className="text-[10px] text-default-400 leading-none">
            Renderer:{" "}
            <span className="text-foreground/70 font-mono">{cellKey}</span>
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
