/**
 * Internal route handler — stewardship of `secrets.cp.userToken`.
 *
 * The Eve dashboard runs the CP OAuth handshake **client-side** (browser
 * redirect → /auth/callback). After exchanging the auth code for a JWT
 * the callback page POSTs the token here so it lands on disk in
 * `~/.eve/secrets/secrets.json` under `cp.userToken` — the same
 * file the rest of Eve already uses.
 *
 * Why route through the server even though the token first appears
 * in the browser:
 *   • The token then lives in a 0600-mode file the operator owns,
 *     not in localStorage where any JS can scrape it.
 *   • Server-side route handlers (e.g. /api/marketplace/...) read
 *     it from disk, attach the bearer header, and proxy upstream —
 *     so the client never needs the token in memory after the
 *     initial write.
 *   • Future refresh-token rotation can happen entirely server-side
 *     without exposing the rotated token back to the browser.
 *
 * All three verbs are gated by the dashboard cookie (`requireAuth`).
 *
 * See: synap-team-docs/content/team/platform/eve-os-vision.mdx §6
 */

import { NextResponse } from "next/server";
import { readEveSecrets, writeEveSecrets, writeCpUserSession } from "@eve/dna";
import { requireAuth } from "@/lib/auth-server";
import { CP_BASE_URL } from "@/lib/cp-base-url";

interface PostBody {
  /** The user-scoped JWT minted by the CP OAuth token endpoint. */
  userToken?: string;
  /** Optional ISO timestamp; defaults to "now" when omitted. */
  issuedAt?: string;
  /** Optional ISO expiry hint (caller may decode `exp` from JWT). */
  expiresAt?: string;
}

/**
 * GET — return the existing `cp.userToken` so client code can probe
 * "am I signed in?" without reading the file directly.
 *
 * The token IS returned in the JSON response, but only to the same-origin
 * dashboard JS that's already authenticated by the dashboard cookie. The
 * value is never persisted by the client; pages that need to call CP
 * endpoints should go through `/api/marketplace/*` proxies instead of
 * holding the token in React state.
 */
export async function GET() {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const secrets = await readEveSecrets();
  const token = secrets?.cp?.userToken?.trim();
  if (!token) {
    return NextResponse.json({ userToken: null }, { status: 200 });
  }
  return NextResponse.json(
    {
      userToken: token,
      issuedAt: secrets?.cp?.issuedAt ?? null,
      expiresAt: secrets?.cp?.expiresAt ?? null,
    },
    { status: 200 },
  );
}

/**
 * POST — write a new token. Called by `/auth/callback` immediately after
 * the OAuth code-for-token exchange succeeds.
 */
export async function POST(req: Request) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const body = (await req.json().catch(() => ({}))) as PostBody;
  const userToken = body.userToken?.trim();
  if (!userToken) {
    return NextResponse.json(
      { error: "`userToken` is required" },
      { status: 400 },
    );
  }

  // Light shape check — JWT is `header.payload.signature` (3 dot-separated
  // base64url segments). Don't validate the signature here; the CP did
  // that already and the marketplace endpoints will reject anything wrong.
  const segments = userToken.split(".");
  if (segments.length !== 3) {
    return NextResponse.json(
      { error: "`userToken` does not look like a JWT" },
      { status: 400 },
    );
  }

  const issuedAt = body.issuedAt ?? new Date().toISOString();

  // Decode basic claims from the JWT payload (best-effort).
  let subFromJwt = "";
  let emailFromJwt = "";
  try {
    const payload = JSON.parse(
      Buffer.from(segments[1], "base64url").toString("utf-8"),
    ) as { sub?: string; email?: string };
    if (typeof payload.sub === "string") subFromJwt = payload.sub;
    if (typeof payload.email === "string") emailFromJwt = payload.email;
  } catch { /* ignore */ }

  // Fetch user profile from CP so we can write a proper cp.userSession.
  // A marketplace-scoped token typically lacks the `email` claim in its
  // JWT payload; fetching GET /auth/get-session resolves the full identity.
  let userId = subFromJwt;
  let email = emailFromJwt;
  let name: string | undefined;
  try {
    const meRes = await fetch(`${CP_BASE_URL}/auth/get-session`, {
      headers: {
        Authorization: `Bearer ${userToken}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });
    if (meRes.ok) {
      const me = (await meRes.json()) as {
        user?: { id?: string; email?: string; name?: string };
      };
      if (typeof me.user?.id === "string" && me.user.id) userId = me.user.id;
      if (typeof me.user?.email === "string" && me.user.email) email = me.user.email;
      if (typeof me.user?.name === "string") name = me.user.name;
    }
  } catch { /* fall back to JWT claims */ }

  if (userId && email) {
    await writeCpUserSession({
      token: userToken,
      userId,
      email,
      name,
      expiresAt: body.expiresAt,
      issuedAt,
    });
  } else {
    // Fallback to legacy slot if we still can't identify the user.
    await writeEveSecrets({
      cp: {
        userToken,
        issuedAt,
        expiresAt: body.expiresAt,
      },
    });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}

/**
 * DELETE — clear the token. Used by sign-out flows (deferred per spec)
 * and by the callback page if it needs to reset stale state before
 * starting a fresh handshake.
 */
export async function DELETE() {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  // Setting all three fields to `undefined` is the merge-preserving way
  // to clear them via writeEveSecrets — Zod will drop the keys.
  await writeEveSecrets({
    cp: {
      userToken: undefined,
      issuedAt: undefined,
      expiresAt: undefined,
    },
  });

  return NextResponse.json({ ok: true }, { status: 200 });
}
