import type { ReactNode } from "react";

import type {
  ProfileRendererContext,
  ProfileRendererResolver,
  ProfileRendererSlot,
  RendererRef,
} from "./types";
import { useResolvedRenderer } from "./useResolvedRenderer";

export interface EntityRendererProps {
  /** The entity profile slug (e.g. "contact", "task", "project"). */
  profileSlug: string;

  /**
   * Workspace context for the resolver. `null` means cross-workspace — Eve
   * passes the entity's own `workspaceId` here, or `null` for pod-wide entities.
   */
  workspaceId: string | null;

  /** Presence dictates the slot: omit → `list`, provide → `detail`. */
  entityId?: string;

  /** Caller-injected resolver. See `ProfileRendererResolver`. */
  resolve: ProfileRendererResolver;

  /** Caller-injected renderer. Maps the resolved `RendererRef` to a React tree. */
  renderTarget: (target: RendererRef) => ReactNode;

  /** Rendered while the resolver is in flight. */
  fallback?: ReactNode;

  /** Rendered when the resolver returns `null`. */
  empty?: ReactNode;

  /** Rendered when the resolver throws. If absent, `empty` is rendered. */
  errorFallback?: (error: Error) => ReactNode;
}

/**
 * The single host every Eve surface uses to open an entity profile or one entity.
 *
 * Resolves via the injected `resolve`, then hands the `RendererRef` to the
 * injected `renderTarget`. The package itself does no rendering and no data
 * fetching — Eve apps wire those.
 */
export function EntityRenderer({
  profileSlug,
  workspaceId,
  entityId,
  resolve,
  renderTarget,
  fallback = null,
  empty = null,
  errorFallback,
}: EntityRendererProps): ReactNode {
  const slot: ProfileRendererSlot = entityId ? "detail" : "list";
  const ctx: ProfileRendererContext = {
    profileSlug,
    workspaceId,
    slot,
    entityId,
  };

  const state = useResolvedRenderer(ctx, resolve);

  if (state.status === "loading") return fallback;
  if (state.status === "error") return errorFallback ? errorFallback(state.error) : empty;
  if (state.status === "not-found") return empty;
  return renderTarget(state.target);
}
