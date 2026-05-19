"use client";

/**
 * Eve OS Data — `KnowledgeGraphCanvas`.
 *
 * Ported verbatim from `synap-app/apps/studio/components/graph/KnowledgeGraphCanvas.tsx`.
 * Same library (`reagraph`), same node/edge shape, same color-per-profile rule.
 * Kept dependency-free of the broader graph-view package so Eve doesn't have
 * to drag Tamagui + workspace deps in.
 */

import { useMemo, useRef } from "react";
import { GraphCanvas, darkTheme, lightTheme } from "reagraph";
import type { GraphCanvasRef } from "reagraph";
import { useTheme } from "next-themes";

export type LayoutType = "forceDirected2d" | "radialOut2d" | "treeTd2d";

export interface GraphEntity {
  id: string;
  title?: string | null;
  profileSlug?: string | null;
  type?: string | null;
}

export interface GraphRelation {
  id: string;
  sourceId: string;
  targetId: string;
  type?: string | null;
}

export interface KnowledgeGraphProps {
  entities: GraphEntity[];
  relations: GraphRelation[];
  onNodeClick?: (entityId: string) => void;
  layoutType?: LayoutType;
}

interface ReagraphNode {
  id: string;
  label: string;
  fill: string;
  data?: Record<string, unknown>;
}

interface ReagraphEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

export default function KnowledgeGraphCanvas({
  entities,
  relations,
  onNodeClick,
  layoutType = "forceDirected2d",
}: KnowledgeGraphProps) {
  const ref = useRef<GraphCanvasRef | null>(null);
  const { resolvedTheme } = useTheme();

  const nodes: ReagraphNode[] = useMemo(
    () =>
      entities.map((e) => {
        const slug = e.profileSlug ?? e.type ?? "default";
        return {
          id: e.id,
          label: e.title && e.title.length > 0 ? e.title : e.id.slice(0, 8),
          fill: colorForProfile(slug),
          data: { profileSlug: slug },
        };
      }),
    [entities],
  );

  const edges: ReagraphEdge[] = useMemo(
    () =>
      relations.map((r) => ({
        id: r.id,
        source: r.sourceId,
        target: r.targetId,
        label: r.type ?? undefined,
      })),
    [relations],
  );

  return (
    <GraphCanvas
      ref={ref}
      nodes={nodes}
      edges={edges}
      layoutType={layoutType}
      theme={resolvedTheme === "dark" ? darkTheme : lightTheme}
      draggable
      labelType="nodes"
      onNodeClick={(node: { id: string }) => onNodeClick?.(node.id)}
    />
  );
}

/** Same palette as the studio graph — profile → fill color. */
function colorForProfile(slug: string): string {
  switch (slug) {
    case "project":
    case "document":
    case "note":
      return "#3b82f6";
    case "person":
    case "contact":
      return "#10b981";
    case "task":
      return "#f59e0b";
    case "company":
      return "#a855f7";
    case "event":
      return "#6366f1";
    default:
      return "#9ca3af";
  }
}
