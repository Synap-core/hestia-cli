// ─── Host (resolver + dispatch) ──────────────────────────────────────────────

export { EntityRenderer } from "./EntityRenderer";
export type { EntityRendererProps } from "./EntityRenderer";

export { useResolvedRenderer } from "./useResolvedRenderer";

export type {
  ProfileRendererContext,
  ProfileRendererResolver,
  ProfileRendererSlot,
  ProfileRendererState,
  RendererRef,
} from "./types";

// ─── Built-in detail renderer (schema-driven, with relations panel) ──────────
//
// Drop-in for any HeroUI-based host. Pure content — no page chrome — so the
// host wraps with its own PaneHeader / breadcrumbs / navigation actions.

export { EntityDetailRenderer } from "./detail";
export type {
  Entity,
  EntityDetailRenderer as EntityDetailRendererType,
  EntityDetailRendererProps,
  EntityPatchFn,
} from "./detail/types";

// ─── Sub-components (for advanced composition) ───────────────────────────────

export { EntityChip } from "./detail/entity-chip";
export type { EntityChipProps } from "./detail/entity-chip";

export { RelationsPanel } from "./detail/relations-panel";
export type {
  Connection,
  RelationsPanelProps,
} from "./detail/relations-panel";

// ─── Helpers re-exported (for host apps that need to assemble custom layouts) ─

export {
  buildSchemaAwareField,
  type EffectivePropertyDef,
  type BuildFieldArgs,
} from "./detail/field-builder";

export { statusColorFor, priorityColorFor } from "./detail/color-maps";
