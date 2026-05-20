/**
 * Shared types for `EntityDetailRenderer` and its sibling components.
 *
 * Lives in the renderer package (not the consuming app) so any app that
 * mounts `<EntityDetailRenderer>` gets the canonical contract. Apps inject
 * data (entity, schema, connections) via props and provide a `patch` for
 * mutations — the renderer is pure content; chrome (page header, navigation)
 * is the host app's job.
 */

import type { ComponentType, ReactNode } from "react";

import type { EffectivePropertyDef } from "./field-builder";
import type { Connection } from "./relations-panel";

/** Pod-shaped entity record returned by `entities.get`. */
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
 * Props every detail renderer receives. All data is injected — the renderer
 * doesn't fetch.
 *
 * - `entity`              — the pod entity to render.
 * - `config`              — `RendererRef.props` payload from the resolver.
 * - `workspaceId`         — entity's workspace (null = cross-pod).
 * - `patch`               — optimistic update helper, already wired by host.
 * - `effectiveProperties` — property defs from `profiles.get`. Drives
 *                            schema-aware widgets. Undefined → renderer
 *                            falls back to `classifyValue()` heuristics.
 * - `connections`         — output of `relations.getConnections`. Unified
 *                            graph + property + thread connections.
 * - `connectionsLoading`  — true while connections are in flight.
 * - `onOpenEntity`        — host-provided navigation hook used by the
 *                            relations panel.
 */
export interface EntityDetailRendererProps {
  entity: Entity;
  config: Record<string, unknown>;
  workspaceId: string | null;
  patch: EntityPatchFn;
  effectiveProperties?: EffectivePropertyDef[];
  connections?: Connection[];
  connectionsLoading?: boolean;
  onOpenEntity?: (entityId: string) => void;
  /**
   * Optional extra node rendered above the hero — most hosts will leave
   * this empty and provide chrome (PaneHeader, breadcrumbs) at the layout
   * level outside the renderer.
   */
  topSlot?: ReactNode;
}

export type EntityDetailRenderer = ComponentType<EntityDetailRendererProps>;
