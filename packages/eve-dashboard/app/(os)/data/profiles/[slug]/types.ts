import type { ComponentType } from "react";

/**
 * Pod entity shape used by the list-slot renderers. Mirrors the detail
 * page's `Entity` — duplicated here so the list folder stays self-contained.
 */
export interface Entity {
  id: string;
  title?: string | null;
  description?: string | null;
  profileSlug?: string | null;
  type?: string | null;
  workspaceId?: string | null;
  properties?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Props every Eve list-slot renderer receives.
 *
 * Renderers don't fetch entities themselves — the page does, so loading
 * states are unified. Renderers are presentational, just choose how to
 * display the array. `config` carries the `RendererRef.props` payload so
 * future renderers can take knobs (columns to show, group-by field, …).
 */
export interface EveListRendererProps {
  profileSlug: string;
  entities: Entity[];
  config: Record<string, unknown>;
  onOpenEntity: (id: string) => void;
}

export type EveListRenderer = ComponentType<EveListRendererProps>;
