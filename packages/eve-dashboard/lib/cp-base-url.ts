/**
 * Resolved CP API base URL for server-side route handlers.
 *
 * Reads, in order:
 *   • `CP_BASE_URL`              — server-only override (preferred)
 *   • `NEXT_PUBLIC_CP_API_URL`   — bundled, used by other surfaces
 *   • `NEXT_PUBLIC_CP_BASE_URL`  — historical name
 *   • `https://api.synap.live`   — production fallback
 *
 * Always trimmed of trailing slashes so downstream concatenation is safe.
 */

export const CP_BASE_URL: string = (
  process.env.CP_BASE_URL ||
  process.env.NEXT_PUBLIC_CP_API_URL ||
  process.env.NEXT_PUBLIC_CP_BASE_URL ||
  "https://api.synap.live"
).replace(/\/+$/, "");
