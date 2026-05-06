/**
 * Shared helpers for working with the pod's tRPC + superjson wire format.
 *
 * The transformer wraps every payload as `result.data.json` when there's
 * something for superjson to enrich (Dates, Sets, Maps …). Procedures
 * that return plain JSON skip the inner `json` key and just use
 * `result.data` directly. We accept both shapes.
 */

export interface TrpcEnvelope<T> {
  result?: { data?: { json?: T } | T };
  error?: { message?: string; code?: string; data?: { code?: string } };
}

/**
 * Unwrap a tRPC + superjson envelope returned by `/api/pod/trpc/*`.
 * Returns the inner data payload, or `null` when the envelope is absent
 * or malformed.
 */
export function unwrapTrpc<T>(env: TrpcEnvelope<T> | null): T | null {
  if (!env) return null;
  const data = env.result?.data;
  if (data && typeof data === "object" && "json" in data) {
    return (data as { json?: T }).json ?? null;
  }
  return (data as T) ?? null;
}
