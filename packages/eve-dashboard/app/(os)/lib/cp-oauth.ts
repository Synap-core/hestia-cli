/**
 * Eve ↔ Synap CP OAuth client (PKCE, RFC 7636).
 *
 * Eve dashboard is a public client running on the operator's own machine.
 * We use Authorization Code + PKCE — the canonical pattern for browser /
 * desktop apps where there's no secure server to hold a client secret.
 *
 * Flow:
 *
 *   1. `initiateCpOAuth()` generates `code_verifier` (random) and
 *      `code_challenge = BASE64URL(SHA256(code_verifier))`. Both verifier
 *      and a fresh `state` value are stashed in `sessionStorage` so the
 *      callback page can read them after the round-trip.
 *
 *   2. The page redirects to
 *      `${CP_BASE_URL}/oauth/authorize?...`. The CP
 *      authenticates the user (existing Better Auth session) and asks
 *      consent.
 *
 *   3. CP redirects back to `${origin}/auth/callback?code=...&state=...`.
 *      The callback page validates `state`, exchanges `code` + verifier
 *      for a JWT at `/oauth/token`, and POSTs the token to
 *      our internal `/api/secrets/cp-token` route handler — which
 *      persists it to `~/.eve/secrets.json` (server-side only).
 *
 *   4. Subsequent fetches to CP go via server-side proxies that pull
 *      the token from disk. The browser never holds it after step 3.
 *
 * See: synap-team-docs/content/team/platform/eve-os-vision.mdx §6
 *      synap-team-docs/content/team/platform/eve-os-home-design.mdx §5.6
 */

// ─── Configuration ────────────────────────────────────────────────────────────

/**
 * Where the CP lives. Configurable so dev environments can point at a
 * staging CP or a local one. Default matches production.
 *
 * IMPORTANT: this value is baked at build time. Different deployments
 * use different `.env` files in their CI pipeline.
 */
export const CP_BASE_URL: string =
  process.env.NEXT_PUBLIC_CP_BASE_URL?.replace(/\/+$/, "") ||
  "https://cp.synap.sh";

/**
 * Eve dashboard's client_id, registered in the CP's OAuth client table.
 * Public-client (no secret), uses PKCE.
 */
export const CP_OAUTH_CLIENT_ID = "eve-dashboard";

/** Scopes Eve asks for. Marketplace-read + install only. No pod admin. */
export const CP_OAUTH_SCOPES = ["marketplace:read", "marketplace:install"];

// SessionStorage keys. Namespaced so we don't clash with anything else.
const SS_VERIFIER = "eve-cp-oauth:verifier";
const SS_STATE = "eve-cp-oauth:state";

// ─── PKCE primitives ──────────────────────────────────────────────────────────

/**
 * RFC 4648 §5 base64url, no padding. `btoa` produces standard base64
 * (with `+`, `/`, `=`); we translate to the URL-safe alphabet.
 */
export function base64UrlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Generate a high-entropy `code_verifier`. RFC 7636 §4.1 mandates
 * 43–128 chars from the unreserved set; 32 random bytes → 43 base64url
 * chars, comfortably inside spec.
 */
export function generateCodeVerifier(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

/**
 * `code_challenge = BASE64URL(SHA256(code_verifier))` per RFC 7636 §4.2.
 * Method is "S256" (we never use the legacy "plain" method).
 */
export async function generateCodeChallenge(verifier: string): Promise<string> {
  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
}

/**
 * CSRF / replay protection. Random opaque string echoed by the
 * authorization server in the callback URL. Caller MUST verify it
 * matches what was sent.
 */
export function generateState(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Begin the OAuth flow. Generates fresh PKCE + state, stashes them in
 * sessionStorage (per-tab so concurrent flows in different tabs don't
 * trample each other), and replaces window.location with the CP's
 * authorize endpoint.
 *
 * Returns nothing — the navigation away never returns control. We mark
 * the return type explicitly so callers can `void initiateCpOAuth()`
 * without a TS error.
 */
export async function initiateCpOAuth(): Promise<void> {
  if (typeof window === "undefined") {
    throw new Error("initiateCpOAuth must be called in the browser");
  }

  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  const state = generateState();

  // Persist BEFORE the navigation — once the redirect happens, JS state
  // is gone but sessionStorage survives the round-trip.
  sessionStorage.setItem(SS_VERIFIER, verifier);
  sessionStorage.setItem(SS_STATE, state);

  const redirectUri = `${window.location.origin}/auth/callback`;

  // Build the authorize URL. Per OAuth 2.1 / RFC 6749 §4.1.1, scopes
  // are space-separated.
  const authorizeUrl = new URL(`${CP_BASE_URL}/oauth/authorize`);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", CP_OAUTH_CLIENT_ID);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("scope", CP_OAUTH_SCOPES.join(" "));
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("code_challenge", challenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");

  window.location.href = authorizeUrl.toString();
}

/**
 * Pop the saved verifier + state for callback validation. Removes both
 * from sessionStorage (single-use). Returns nulls when nothing is
 * stashed — caller should treat that as "no flow in progress, abort".
 */
export function consumeOAuthChallenge(): {
  verifier: string | null;
  state: string | null;
} {
  if (typeof window === "undefined") return { verifier: null, state: null };
  const verifier = sessionStorage.getItem(SS_VERIFIER);
  const state = sessionStorage.getItem(SS_STATE);
  sessionStorage.removeItem(SS_VERIFIER);
  sessionStorage.removeItem(SS_STATE);
  return { verifier, state };
}

/**
 * Probe whether we currently have a user-scoped CP token on disk.
 *
 * Goes via the server-side route handler so the actual token never
 * needs to be embedded in client-rendered HTML. The caller should
 * NOT cache the returned token — it can be rotated server-side at
 * any time.
 *
 * Returns `null` when no token is configured (the home should show
 * the sign-in banner).
 */
export async function getCpUserToken(): Promise<string | null> {
  try {
    const res = await fetch("/api/secrets/cp-token", {
      credentials: "include",
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { userToken?: string | null };
    const t = data.userToken?.trim();
    return t && t.length > 0 ? t : null;
  } catch {
    return null;
  }
}

/**
 * Drop the stored token. Used by sign-out (deferred) and by the
 * callback page when it needs to reset stale state.
 */
export async function clearCpUserToken(): Promise<void> {
  try {
    await fetch("/api/secrets/cp-token", {
      method: "DELETE",
      credentials: "include",
    });
  } catch {
    // Best-effort — if the route is unreachable the operator can
    // still wipe the file by hand. Don't block sign-out on this.
  }
}

/**
 * Persist a freshly-minted token. The OAuth callback page calls this
 * after the token-exchange step succeeds.
 *
 * @returns `true` on a successful write, `false` otherwise (caller
 *          surfaces a retry banner).
 */
export async function persistCpUserToken(args: {
  userToken: string;
  issuedAt?: string;
  expiresAt?: string;
}): Promise<boolean> {
  try {
    const res = await fetch("/api/secrets/cp-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(args),
    });
    return res.ok;
  } catch {
    return false;
  }
}
