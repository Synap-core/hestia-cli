/**
 * Allowlist of origins that Eve is permitted to exchange postMessage
 * session tokens with.
 *
 * Rules:
 *   - Any `*.synap.live` subdomain over HTTPS is allowed (production).
 *   - Any `localhost` origin regardless of port is allowed (development).
 *   - Runtime manifest origins may be added as exact origins by callers.
 *   - Everything else is silently rejected.
 *
 * Used by `app-pane.tsx` in the Eve dashboard: Eve only responds to
 * `synap:ready` handshakes from these origins, and only posts the
 * `synap:auth` session payload to their exact origin — never to `"*"`.
 */

const SYNAP_LIVE_RE = /^https:\/\/[a-z0-9-]+\.synap\.live$/;
const LOCALHOST_RE = /^https?:\/\/localhost(:\d+)?$/;

export type AllowedEmbedOriginInput = string | URL;
export type AllowedEmbedOrigins = Iterable<AllowedEmbedOriginInput>;
export type AllowedEmbedOriginChecker = (origin: string) => boolean;

/**
 * Build an origin checker with Eve's default allowlist plus exact runtime
 * manifest origins supplied by the caller.
 */
export function createAllowedEmbedOriginChecker(
  extraAllowedOrigins?: AllowedEmbedOrigins,
): AllowedEmbedOriginChecker {
  const extraOrigins = normalizeAllowedOrigins(extraAllowedOrigins);

  return (origin: string): boolean => isDefaultAllowedOrigin(origin) || extraOrigins.has(origin);
}

/**
 * Returns true when `origin` is an approved embed target for Eve's
 * postMessage auth handshake.
 *
 * The optional `extraAllowedOrigins` parameter accepts runtime manifest app
 * URLs or origins. Entries are normalized to exact origins before matching.
 */
export function isAllowedEmbedOrigin(
  origin: string,
  extraAllowedOrigins?: AllowedEmbedOrigins,
): boolean {
  if (isDefaultAllowedOrigin(origin)) return true;
  return normalizeAllowedOrigins(extraAllowedOrigins).has(origin);
}

function isDefaultAllowedOrigin(origin: string): boolean {
  return LOCALHOST_RE.test(origin) || SYNAP_LIVE_RE.test(origin);
}

function normalizeAllowedOrigins(extraAllowedOrigins?: AllowedEmbedOrigins): ReadonlySet<string> {
  const origins = new Set<string>();
  if (!extraAllowedOrigins) return origins;

  for (const value of extraAllowedOrigins) {
    const origin = normalizeAllowedOrigin(value);
    if (origin) origins.add(origin);
  }

  return origins;
}

function normalizeAllowedOrigin(value: AllowedEmbedOriginInput): string | null {
  try {
    const origin = value instanceof URL ? value.origin : new URL(value).origin;
    return origin === 'null' ? null : origin;
  } catch {
    return null;
  }
}
