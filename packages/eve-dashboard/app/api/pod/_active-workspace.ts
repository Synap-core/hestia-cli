/**
 * Server-side helper for the `/api/pod/*` proxy: read the operator's
 * active workspace from the incoming request.
 *
 * Contract:
 *   The CLIENT is the source of truth. Browser-side code (panels,
 *   hooks) attaches `x-workspace-id: <uuid>` whenever it calls a
 *   pod `workspaceProcedure`. The proxy just forwards the header
 *   upstream — the catch-all in `[...path]/route.ts` already preserves
 *   any non-hop-by-hop header by default. This helper exists so we
 *   have a single, testable point that documents the contract and
 *   that the proxy can use to log / annotate.
 *
 * We deliberately do NOT read `localStorage` here — the proxy runs on
 * the server, can't see the browser's storage, and shouldn't second-
 * guess the client. If the header is missing we return `null` and
 * the upstream `workspaceProcedure` middleware will reject the call
 * with a clear error that the panel surfaces.
 */

/**
 * Read the operator's active workspace id from a Next.js request.
 * Returns `null` when the client didn't supply the header.
 *
 * Header name match is case-insensitive (per the Fetch spec, Headers
 * already normalises lookups).
 */
export async function resolveActiveWorkspaceServer(
  req: Request,
): Promise<string | null> {
  const id = req.headers.get("x-workspace-id");
  if (!id) return null;
  const trimmed = id.trim();
  return trimmed.length > 0 ? trimmed : null;
}
