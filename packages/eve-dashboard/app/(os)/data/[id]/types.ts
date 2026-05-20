/**
 * Shared types for the Eve data detail surface (`/data/[id]`).
 *
 * `Entity` is the pod-shaped record returned by `entities.get`. Lives here
 * (not in a global types file) because the detail page is the single
 * consumer outside the renderers themselves.
 *
 * `EveDetailRenderer` is the contract every registered detail renderer
 * must implement. The page's `RENDERERS` map keys cell keys to renderers
 * of this shape. New renderers (gallery, document-style, kanban-card,
 * AI-generated configs) implement the same shape and slot in.
 */

import type { ComponentType, ReactNode } from "react";

import type { Connection } from "./renderers/entity-detail/relations-panel";
import type { EffectivePropertyDef } from "./renderers/entity-detail/field-builder";

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

/** Patch function the renderer calls to update the entity. */
export type EntityPatchFn = (input: Record<string, unknown>) => Promise<void>;

/**
 * Props every Eve detail renderer receives.
 *
 * - `entity` — the pod entity to render.
 * - `config` — the `RendererRef.props` payload from the resolver
 *   (renderer-specific knobs; ignore if not relevant).
 * - `workspaceId` — the entity's workspace (or `null` for cross-pod entities).
 * - `patch` — optimistic update helper, already wired with rollback.
 * - `onBack` — navigation back to the list slot.
 * - `effectiveProperties` — property defs from `profiles.get` for the
 *   entity's profile. Drives schema-aware field widgets in renderers that
 *   support it. Undefined when the call wasn't made (cross-pod) or is
 *   in-flight; renderers should fall back to `classifyValue()` heuristics.
 * - `connections` — output of `relations.getConnections` for the entity.
 *   Already a unified list across graph relations, property links, and
 *   thread mentions.
 * - `connectionsLoading` — true while connections are in flight (so
 *   renderers can show a skeleton in the relations panel).
 * - `onOpenEntity` — navigate to another entity's detail page. Used by
 *   the relations panel.
 */
export interface EveDetailRendererProps {
  entity: Entity;
  config: Record<string, unknown>;
  workspaceId: string | null;
  patch: EntityPatchFn;
  onBack: () => void;
  effectiveProperties?: EffectivePropertyDef[];
  connections?: Connection[];
  connectionsLoading?: boolean;
  onOpenEntity?: (entityId: string) => void;
}

export type EveDetailRenderer = ComponentType<EveDetailRendererProps>;

/** Render slot for the host's `empty` / `errorFallback` branches. */
export type RenderTargetFn = (target: unknown) => ReactNode;
