import { useEffect, useState } from "react";

import type {
  ProfileRendererContext,
  ProfileRendererResolver,
  ProfileRendererState,
} from "./types";

/**
 * Resolves a profile renderer for the given context.
 *
 * Stateful. Reruns when any of the context's identity fields change.
 * Cancellation-safe — late results from previous calls are discarded.
 *
 * The resolver is treated as a referentially stable function. Wrap unstable
 * resolvers with `useCallback` in the caller.
 */
export function useResolvedRenderer(
  ctx: ProfileRendererContext,
  resolve: ProfileRendererResolver,
): ProfileRendererState {
  const [state, setState] = useState<ProfileRendererState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });

    resolve(ctx)
      .then((target) => {
        if (cancelled) return;
        setState(target ? { status: "resolved", target } : { status: "not-found" });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({
          status: "error",
          error: error instanceof Error ? error : new Error(String(error)),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [ctx.profileSlug, ctx.workspaceId, ctx.slot, ctx.entityId, resolve]);

  return state;
}
