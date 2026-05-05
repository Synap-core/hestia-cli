/**
 * POST /api/auth/pod-signin — explicit "mint a pod user-session token".
 *
 * The /api/pod/* catch-all auto-mints when the cached token is missing
 * or expired. But that auto-mint relies on `pod.userEmail` already
 * being persisted from a prior signin. This route is the FIRST signin
 * — it accepts an explicit email, runs the JWT-Bearer exchange, and
 * persists the token + email in `~/.eve/secrets.json`.
 *
 * Body:  { "email": "alice@example.com" }
 * Returns:
 *   200 { ok: true, expiresAt, user: { id, email, name } }
 *   400 invalid email
 *   401 if not signed in to local Eve dashboard
 *   503 misconfigured (no pod URL or no Eve external URL)
 *   <upstream-status> exchange failed (issuer not approved, user not
 *   found, JWT signature failure, etc.) — body carries the OAuth error
 *   code for the UI to map.
 *
 * After this returns 200 the operator can call any `/api/pod/*` route
 * — the catch-all reuses the cached token until it nears expiry, then
 * silently re-mints (operator never re-authenticates separately as
 * long as the local Eve dashboard cookie is good).
 *
 * See: synap-team-docs/content/team/platform/eve-credentials.mdx §4
 */

import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-server";
import { mintAndStorePodUserToken, PodSigninError } from "../../pod/_lib";

interface SigninBody {
  email?: unknown;
}

export async function POST(req: Request) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const body = (await req.json().catch(() => null)) as SigninBody | null;
  const rawEmail = typeof body?.email === "string" ? body.email.trim() : "";
  if (!rawEmail) {
    return NextResponse.json(
      { error: "email is required" },
      { status: 400 },
    );
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
    return NextResponse.json(
      { error: "Invalid email address" },
      { status: 400 },
    );
  }

  try {
    const minted = await mintAndStorePodUserToken(rawEmail);
    return NextResponse.json({
      ok: true,
      expiresAt: minted.expiresAt,
      user: minted.user,
    });
  } catch (err) {
    if (err instanceof PodSigninError) {
      return NextResponse.json(
        {
          error: err.code,
          message: err.message,
          ...(err.description ? { description: err.description } : {}),
        },
        { status: err.upstreamStatus },
      );
    }
    return NextResponse.json(
      {
        error: "mint_failed",
        message: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
