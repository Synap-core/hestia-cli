/**
 * Profile renderer types for Eve OS.
 *
 * `RendererRef` mirrors `RendererTarget` from `@synap-core/renderer-runtime`
 * exactly. We inline it here rather than depending on the Synap workspace
 * because Eve OS is in a separate pnpm workspace (`hestia-cli/`). The shape
 * is set by the backend's `RendererRefSchema` (Zod) — both this file and
 * the Synap mirror are downstream of that contract.
 *
 * Spec: synap-team-docs/content/team/platform/profile-renderer.mdx
 */

/**
 * Two slots per profile.
 * - `list`   — show every entity of this profile (e.g. the data graph, a kanban board, a table).
 * - `detail` — show one specific entity (the rich detail page).
 */
export type ProfileRendererSlot = "list" | "detail";

/**
 * What a profile or workspace stores as its renderer choice.
 *
 * Two paths encoded by `kind`:
 * - **Config path** — typed, registered, safe to render: `cell` (key-based registry lookup) or `view` (saved view row)
 * - **File path** — sandboxed iframe: `iframe-srcdoc` (inline bundle) or `external-app` (pod-served URL)
 * - `url` — passthrough link
 *
 * For Phase 1 on Eve, only the `cell` kind is honored — `cellKey` looks up
 * an entry in the local Eve renderer registry. File path renderers are
 * Phase 3 (require the Pod SDK + sandbox host).
 */
export type RendererRef =
  | {
      kind: "cell";
      cellKey: string;
      props: Record<string, unknown>;
      title?: string;
      displayMode?: string;
      rendererHint?: Record<string, unknown>;
    }
  | {
      kind: "view";
      viewId: string;
      title?: string;
      displayMode?: string;
    }
  | {
      kind: "iframe-srcdoc";
      appId: string;
      srcdoc: string;
      title?: string;
      props?: Record<string, unknown>;
    }
  | {
      kind: "external-app";
      appId: string;
      url: string;
      title?: string;
      props?: Record<string, unknown>;
    }
  | {
      kind: "url";
      url: string;
      external?: boolean;
      title?: string;
    };

/** Inputs the host gives the resolver. */
export interface ProfileRendererContext {
  profileSlug: string;
  workspaceId: string | null;
  slot: ProfileRendererSlot;
  entityId?: string;
}

/**
 * Caller-injected resolver. Typical Eve implementation calls
 * `trpc.profiles.getEffectiveRenderers` via `podTrpcFetch`.
 *
 * Returns `null` when the resolver wants the host to render its `empty` state.
 */
export type ProfileRendererResolver = (
  ctx: ProfileRendererContext,
) => Promise<RendererRef | null>;

/** Hook state machine. Dependency-free — no TanStack Query coupling. */
export type ProfileRendererState =
  | { status: "loading" }
  | { status: "resolved"; target: RendererRef }
  | { status: "not-found" }
  | { status: "error"; error: Error };
