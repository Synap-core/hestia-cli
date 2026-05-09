/**
 * Allowlist of origins that Eve is permitted to exchange postMessage
 * session tokens with.
 *
 * Rules:
 *   - Any `*.synap.live` subdomain over HTTPS is allowed (production).
 *   - Any `localhost` origin regardless of port is allowed (development).
 *   - Everything else is silently rejected.
 *
 * Used by `app-pane.tsx` in the Eve dashboard: Eve only responds to
 * `synap:ready` handshakes from these origins, and only posts the
 * `synap:auth` session payload to their exact origin — never to `"*"`.
 */

const SYNAP_LIVE_RE = /^https:\/\/[a-z0-9-]+\.synap\.live$/;
const LOCALHOST_RE = /^https?:\/\/localhost(:\d+)?$/;

/**
 * Returns true when `origin` is an approved embed target for Eve's
 * postMessage auth handshake.
 */
export function isAllowedEmbedOrigin(origin: string): boolean {
  return LOCALHOST_RE.test(origin) || SYNAP_LIVE_RE.test(origin);
}
