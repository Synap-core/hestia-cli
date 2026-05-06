"use client";

/**
 * `podTrpcFetch` — thin client-side wrapper around `/api/pod/trpc/<proc>`.
 *
 * The Inbox panels and any other operator-action UI talk to the pod's
 * tRPC surface through the user-channel proxy at `/api/pod/*`. The
 * superjson envelope, the URL-encoded `?input=…` for queries, and the
 * `x-workspace-id` header for `workspaceProcedure` calls have all
 * shown up inline in three or four places already — this helper
 * centralises the boilerplate so panels don't drift apart.
 *
 * Header contract:
 *   - Pass `opts.workspaceId` to override the active workspace
 *     explicitly (e.g. workspace switcher preview).
 *   - Otherwise we read `eve.activeWorkspaceId` from `localStorage`
 *     via `readActiveWorkspaceId()`. If still null, we send NO
 *     `x-workspace-id` header — `workspaceProcedure` calls will fail
 *     loud upstream and the caller's UI shows the empty state.
 *
 * Returns the unwrapped data payload (`result.data.json` or `result.data`).
 * Throws `PodTrpcError` on non-2xx with the upstream tRPC error message
 * pulled out of the standard envelope when present.
 *
 * Why client-only: the helper reads `localStorage`. Server components
 * shouldn't call this — they have no concept of an "active workspace".
 */

import { readActiveWorkspaceId } from "../../hooks/use-active-workspace";
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
  /** Override the active workspace id. Pass `null` to send no header. */
  workspaceId?: string | null;
  /** AbortSignal for cancellation. */
  signal?: AbortSignal;
}

/**
 * Resolve the workspace header for a single call. Order of precedence:
 *   1. Explicit `opts.workspaceId` (string → use, null → no header).
 *   2. localStorage cached value.
 *   3. Nothing.
 */
function resolveWorkspaceHeader(
  opts: PodTrpcFetchOptions | undefined,
): string | null {
  if (opts && "workspaceId" in opts) {
    return opts.workspaceId ?? null;
  }
  return readActiveWorkspaceId();
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
  input?: unknown,
  opts?: PodTrpcFetchOptions,
): Promise<T> {
  const method: "GET" | "POST" = opts?.method ?? "GET";
  const headers: Record<string, string> = {
    Accept: "application/json",
  };

  const workspaceId = resolveWorkspaceHeader(opts);
  if (workspaceId) headers["x-workspace-id"] = workspaceId;

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
