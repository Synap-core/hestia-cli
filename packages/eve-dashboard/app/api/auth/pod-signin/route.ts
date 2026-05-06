/**
 * POST /api/auth/pod-signin — explicit "mint a pod user-session token".
 *
 * The /api/pod/* catch-all auto-mints when the cached token is missing
 * or expired. But that auto-mint relies on `pod.userEmail` already
 * being persisted from a prior signin. This route is the FIRST signin
 * — it accepts an explicit email, runs the JWT-Bearer exchange, and
 * (for the host owner) persists the token + email in
 * `~/.eve/secrets.json`. For non-owners the token is returned in the
 * response body; the browser stores it client-side. See "Multi-user
 * model" below.
 *
 * Body: `{ "email": "alice@example.com", "cpToken"?: string }`
 *
 *   • `email`    — the operator email to mint a pod session for. Must
 *                  exist on the pod as a human user with a Kratos identity.
 *   • `cpToken`  — optional CP bearer JWT. When present, used to
 *                  identify the requester for the multi-user gate (see
 *                  below). When absent we fall back to the legacy
 *                  "host owner only" path — the request is treated as
 *                  the owner.
 *
 * Returns:
 *   200 `{ ok: true, role: "owner", expiresAt, user }`        — owner path,
 *                                                              token persisted to disk.
 *   200 `{ ok: true, role: "member", token, expiresAt, user }` — non-owner,
 *                                                              token in body only.
 *   400 invalid email / cpToken
 *   401 not signed in to local Eve dashboard
 *   401 cpToken provided but invalid (CP rejected it)
 *   503 misconfigured (no pod URL or no Eve external URL)
 *   <upstream-status> exchange failed (issuer not approved, user not
 *   found, JWT signature failure, etc.)
 *
 * ──────────────────────────────────────────────────────────────────────
 * Multi-user model
 * ──────────────────────────────────────────────────────────────────────
 *
 * `~/.eve/secrets.json` is mode 0600 and tied to the host owner.
 * Persisting another user's pod token there would silently grant the
 * owner access to that user's pod session. So we split:
 *
 *   • Host owner   → token persists to disk (`pod.userToken` slot).
 *                    Subsequent `/api/pod/*` calls auto-renew from disk.
 *   • Other user   → token lives in the response body only. The browser
 *                    stores it client-side (e.g. in-memory + localStorage)
 *                    and presents it on subsequent requests.
 *
 * "Owner" detection rule:
 *   1. Read `cp.userSession.userId` (the persisted host-owner identity).
 *   2. Verify the request's `cpToken` against CP's `/auth/get-session`
 *      to learn the requester's userId.
 *   3. If they match → owner path. Otherwise → member path.
 *
 * Backward compatibility: when `cpToken` is absent, the owner path is
 * taken (preserves single-user installs that haven't adopted the new
 * dashboard auth). New surfaces SHOULD pass `cpToken` so the gate can
 * actually fire when a different user signs in to the same browser.
 *
 * See: synap-team-docs/content/team/platform/eve-credentials.mdx §4
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { readCpUserSession } from "@eve/dna";
import { requireAuth } from "@/lib/auth-server";
import { CP_BASE_URL } from "@/lib/cp-base-url";
import {
  mintAndStorePodUserToken,
  mintPodUserToken,
  PodSigninError,
  verifyCpTokenAgainstControlPlane,
} from "../../pod/_lib";

const BodySchema = z.object({
  email: z.string().min(1),
  cpToken: z.string().min(1).optional(),
});

export async function POST(req: Request) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "invalid_request",
        message: parsed.error?.issues?.[0]?.message ?? "Body is malformed",
      },
      { status: 400 },
    );
  }

  const rawEmail = parsed.data.email.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
    return NextResponse.json(
      { error: "Invalid email address" },
      { status: 400 },
    );
  }

  // ── Owner detection ──────────────────────────────────────────────────
  // Default = owner (back-compat with installs that don't pass cpToken).
  // Once cpToken is provided we do a real check.
  let isHostOwner = true;
  if (parsed.data.cpToken) {
    const verified = await verifyCpTokenAgainstControlPlane(
      parsed.data.cpToken,
      CP_BASE_URL,
    );
    if (!verified) {
      return NextResponse.json(
        { error: "cp_token_invalid" },
        { status: 401 },
      );
    }
    const owner = await readCpUserSession();
    // No persisted owner yet → the requester effectively becomes one.
    // The actual ownership write is the /api/auth/sync route's job;
    // here we just mint the pod session for them.
    if (owner && owner.userId && owner.userId !== verified.userId) {
      isHostOwner = false;
    }
  }

  try {
    const minted = isHostOwner
      ? await mintAndStorePodUserToken(rawEmail)
      : await mintPodUserToken(rawEmail);

    return NextResponse.json({
      ok: true,
      role: isHostOwner ? "owner" : "member",
      // Owner path: token already on disk; we still echo it so callers
      // that want to seed an in-memory cache can do so without a re-mint.
      token: minted.token,
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
