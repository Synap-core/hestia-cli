"use client";

/**
 * `podTrpcFetch` — low-level pod tRPC primitive. **Most code should use
 * `usePodQuery` instead** — it picks up the active scope and chooses the
 * right procedure variant + workspace header for you.
 *
 * Direct callers must declare their scope explicitly via `opts.workspaceId`:
 *   - `string`  → send as `x-workspace-id` header (workspace-scoped call)
 *   - `null`    → send NO header (user-wide / pod-level call)
 *
 * The previous implicit default that read `localStorage.eve.activeWorkspaceId`
 * has been removed — it silently coerced every Eve query to one workspace
 * (or to "globals only" when unset), which broke pod-wide views. All scope
 * decisions now flow through `<ScopeProvider>` + `usePodQuery`.
 *
 * Returns the unwrapped data payload (`result.data.json` or `result.data`).
 * Throws `PodTrpcError` on non-2xx with the upstream tRPC error message
 * pulled out of the standard envelope when present.
 */

import { unwrapTrpc } from "@/lib/trpc-utils";
import type { TrpcEnvelope } from "@/lib/trpc-utils";

/** Re-export for callers that import TrpcEnvelope from this module. */
export type { TrpcEnvelope };

export class PodTrpcError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "PodTrpcError";
  }
}

export interface PodTrpcFetchOptions {
  method?: "GET" | "POST";
  /**
   * Required scope decision for this call:
   *   - `string` → send `x-workspace-id` header (workspace-scoped).
   *   - `null`   → send no header (user-wide / pod-level).
   * No implicit default — the caller MUST pick one.
   */
  workspaceId: string | null;
  /** AbortSignal for cancellation. */
  signal?: AbortSignal;
}

/**
 * Build the `?input=…` query string for tRPC GET. Superjson wraps the
 * payload as `{ json: <data> }` — empty inputs (e.g. a bare `query()`)
 * accept `{ json: undefined }` which encodes to no query at all.
 */
function buildInputQuery(input: unknown): string {
  if (input === undefined) return "";
  const encoded = encodeURIComponent(JSON.stringify({ json: input }));
  return `?input=${encoded}`;
}

export async function podTrpcFetch<T>(
  procedure: string,
  input: unknown,
  opts: PodTrpcFetchOptions,
): Promise<T> {
  const method: "GET" | "POST" = opts.method ?? "GET";
  const headers: Record<string, string> = {
    Accept: "application/json",
  };

  if (opts.workspaceId !== null) headers["x-workspace-id"] = opts.workspaceId;

  let url = `/api/pod/trpc/${procedure}`;
  let body: string | undefined;

  if (method === "GET") {
    url += buildInputQuery(input);
  } else {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify({ json: input ?? null });
  }

  const r = await fetch(url, {
    method,
    credentials: "include",
    cache: "no-store",
    headers,
    body,
    signal: opts?.signal,
  });

  if (!r.ok) {
    // tRPC error responses still parse as JSON with an `error` envelope.
    // We surface the inner message when we can; otherwise the raw status.
    const env = (await r.json().catch(() => null)) as TrpcEnvelope<T> | null;
    const code =
      env?.error?.data?.code ?? env?.error?.code ?? `HTTP_${r.status}`;
    const message =
      env?.error?.message ?? `Pod returned ${r.status} for ${procedure}`;
    throw new PodTrpcError(message, r.status, code);
  }

  const env = (await r.json().catch(() => null)) as TrpcEnvelope<T> | null;
  const data = unwrapTrpc(env);
  // tRPC procedures that return `void` will hand us `null` here; for
  // mutations that's fine — most callers don't read the payload anyway.
  return data as T;
}
