"use client";

/**
 * `podRendererResolver` — the Eve OS resolver for `<EntityRenderer>`.
 *
 * Calls the pod's tRPC `profiles.getEffectiveRenderers` procedure (a
 * `podProcedure` — accepts both with-workspace and null-workspace callers).
 * Returns the RendererRef for the requested slot, or `null` when nothing
 * resolves to anything (caller picks the empty state).
 *
 * Resolution semantics happen entirely on the pod — Eve just unwraps the
 * envelope and picks the slot the caller asked for.
 *
 * Spec: synap-team-docs/content/team/platform/profile-renderer.mdx
 */

import type {
  ProfileRendererContext,
  ProfileRendererResolver,
  RendererRef,
} from "@eve/profile-renderer";

import { podTrpcFetch } from "@/lib/pod-fetch";

interface EffectiveRenderersResult {
  list: RendererRef | null;
  detail: RendererRef | null;
}

/**
 * Default Eve resolver. Stable identity — safe to pass directly as a prop
 * (no need to wrap in `useCallback`).
 */
export const podRendererResolver: ProfileRendererResolver = async (
  ctx: ProfileRendererContext,
): Promise<RendererRef | null> => {
  const result = await podTrpcFetch<EffectiveRenderersResult>(
    "profiles.getEffectiveRenderers",
    { profileSlug: ctx.profileSlug, slot: ctx.slot },
    { workspaceId: ctx.workspaceId, method: "GET" },
  );

  return ctx.slot === "list" ? result.list : result.detail;
};
