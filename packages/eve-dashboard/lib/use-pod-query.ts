"use client";

/**
 * Single canonical hook for **every** Eve pod query. Replaces direct
 * `podTrpcFetch` calls scattered across hooks and panels.
 *
 *   usePodQuery("entities.list", input)
 *
 * Scope-aware: reads the nearest `<ScopeProvider>` and routes to either:
 *
 *   • Workspace scope        → `<procedure>` + `x-workspace-id` header
 *   • User-wide scope        → `<procedure>All` (e.g. `entities.listAll`)
 *                              with NO workspace header
 *   • User-wide + no .listAll → client-side fan-out across
 *                              `workspaces.list` (one call per workspace +
 *                              one globals pass), deduped by `id`.
 *
 * The fan-out path is the compatibility shim for procedures that haven't
 * grown `.listAll` variants yet. Once the backend exposes them, the helper
 * automatically prefers the direct call and the fan-out becomes dead code.
 *
 * State machine: `{ kind: "loading" | "ready" | "unpaired" | "error" }`.
 * Always include the "unpaired" branch in your UI so the operator can pair
 * the pod from /settings.
 */

import { useCallback, useEffect, useState } from "react";

import { podTrpcFetch, PodTrpcError } from "./pod-fetch";
import { useScope, type Scope } from "./scope";

// ─── Result shape ─────────────────────────────────────────────────────────────

export type PodQueryState<T> =
  | { kind: "loading" }
  | { kind: "unpaired" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: T };

export interface PodQueryResult<T> {
  state: PodQueryState<T>;
  refresh: () => void;
}

// ─── Options ──────────────────────────────────────────────────────────────────

export interface UsePodQueryOptions {
  /**
   * For procedures that DO have a `.listAll` variant on the pod, pass it
   * here. The helper switches to the direct user-wide call.
   *
   * Procedures with `.listAll`: entities, proposals, notifCenter,
   * graph.getStats. (Activity is already user-scoped on the pod —
   * use a normal usePodQuery for activity routes; no .listAll needed.)
   */
  userWideProcedure?: string;
  /**
   * For fan-out (compat path): the field on the response that contains
   * the array we should dedupe. Most pod list endpoints use `items` (or
   * `entities` legacy). Provide the function only when the shape is
   * non-standard.
   */
  extractItems?: (response: unknown) => unknown[];
  /**
   * When set, only run the query when this is true. Default: true.
   */
  enabled?: boolean;
  /**
   * Skip the workspace iteration in user-wide mode and just call the
   * procedure without a workspace header. Useful when a procedure is
   * already user-scoped on the pod (e.g. `events.read`, `workspaces.list`).
   */
  skipFanout?: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DEFAULT_EXTRACT_ITEMS = (response: unknown): unknown[] => {
  if (!response || typeof response !== "object") return [];
  const r = response as Record<string, unknown>;
  if (Array.isArray(r.items)) return r.items;
  if (Array.isArray(r.entities)) return r.entities;
  if (Array.isArray(r.proposals)) return r.proposals;
  if (Array.isArray(r.notifications)) return r.notifications;
  if (Array.isArray(r.events)) return r.events;
  return [];
};

interface WorkspacesListResponse {
  workspaces?: Array<{ id: string }>;
  items?: Array<{ id: string }>;
}

/**
 * Resolve which procedure to call + how, given a scope.
 *
 * Returns a function that, when invoked, returns the raw response of
 * type `T`. The fan-out path returns a merged response shaped like
 * `{ items: T[] }` (or whatever `extractItems` pulls out, deduped by `id`).
 */
async function runScopedQuery<T>(
  procedure: string,
  input: unknown,
  scope: Scope,
  opts: UsePodQueryOptions,
  signal: AbortSignal,
): Promise<T> {
  // Workspace scope → direct call with header.
  if (scope.kind === "workspace") {
    return podTrpcFetch<T>(procedure, input, {
      workspaceId: scope.workspaceId,
      signal,
    });
  }

  // User-wide + skipFanout → call without a workspace header.
  if (opts.skipFanout) {
    return podTrpcFetch<T>(procedure, input, { workspaceId: null, signal });
  }

  // User-wide + .listAll exists on the pod → direct call.
  if (opts.userWideProcedure) {
    return podTrpcFetch<T>(opts.userWideProcedure, input, {
      workspaceId: null,
      signal,
    });
  }

  // User-wide + no .listAll → client-side fan-out.
  return fanOutQuery<T>(procedure, input, opts, signal);
}

/**
 * Compat: call the workspace-scoped procedure once per workspace the
 * operator belongs to, plus one globals-only pass, then merge.
 */
async function fanOutQuery<T>(
  procedure: string,
  input: unknown,
  opts: UsePodQueryOptions,
  signal: AbortSignal,
): Promise<T> {
  const extract = opts.extractItems ?? DEFAULT_EXTRACT_ITEMS;

  const wsResponse = await podTrpcFetch<WorkspacesListResponse>(
    "workspaces.list",
    { includeArchived: false },
    { workspaceId: null, signal },
  );
  const workspaces = wsResponse.workspaces ?? wsResponse.items ?? [];

  const baseInput = (input ?? {}) as Record<string, unknown>;
  const globalsInput = { ...baseInput, globalOnly: true };

  const perWorkspace = await Promise.all([
    ...workspaces.map((w) =>
      podTrpcFetch<unknown>(procedure, input, {
        workspaceId: w.id,
        signal,
      }).catch((err) => {
        // eslint-disable-next-line no-console
        console.warn(`${procedure} failed for workspace ${w.id}:`, err);
        return {};
      }),
    ),
    podTrpcFetch<unknown>(procedure, globalsInput, {
      workspaceId: null,
      signal,
    }).catch((err) => {
      // eslint-disable-next-line no-console
      console.warn(`${procedure} failed for globals:`, err);
      return {};
    }),
  ]);

  // Dedupe by `id` — the typical primary key for pod entities.
  const byId = new Map<string, unknown>();
  for (const batch of perWorkspace) {
    for (const item of extract(batch)) {
      const id =
        item && typeof item === "object" && "id" in item
          ? String((item as { id: unknown }).id)
          : undefined;
      if (id !== undefined && !byId.has(id)) byId.set(id, item);
    }
  }

  // Return a normalized envelope. Callers that need pagination should
  // request `.listAll` on the backend so this path is bypassed.
  return { items: Array.from(byId.values()) } as unknown as T;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function usePodQuery<T>(
  procedure: string,
  input?: unknown,
  opts: UsePodQueryOptions = {},
): PodQueryResult<T> {
  const scope = useScope();
  const [state, setState] = useState<PodQueryState<T>>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);

  const enabled = opts.enabled !== false;

  // Stable string keys for the effect deps — JSON.stringify is the cheap
  // way to detect prop equality without dragging in a deep-compare hook.
  const inputKey = JSON.stringify(input ?? null);
  const scopeKey =
    scope.kind === "workspace" ? `ws:${scope.workspaceId}` : "user-wide";
  const optsKey = JSON.stringify({
    userWideProcedure: opts.userWideProcedure,
    skipFanout: opts.skipFanout,
  });

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let cancelled = false;

    setState({ kind: "loading" });
    (async () => {
      try {
        const data = await runScopedQuery<T>(
          procedure,
          input,
          scope,
          opts,
          controller.signal,
        );
        if (!cancelled) setState({ kind: "ready", data });
      } catch (err) {
        if (cancelled) return;
        if ((err as { name?: string }).name === "AbortError") return;
        if (err instanceof PodTrpcError && err.status === 503) {
          setState({ kind: "unpaired" });
          return;
        }
        setState({
          kind: "error",
          message:
            err instanceof Error ? err.message : `${procedure} failed`,
        });
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [procedure, inputKey, scopeKey, optsKey, enabled, reloadKey]);

  const refresh = useCallback(() => setReloadKey((k) => k + 1), []);

  return { state, refresh };
}
