/**
 * POST /api/auth/pod-signin — explicit "mint a pod user-session token".
 *
 * The /api/pod/* catch-all auto-mints when the cached token is missing
 * or expired. But that auto-mint relies on `pod.userEmail` already
 * being persisted from a prior signin. This route is the FIRST signin
 * — it accepts an explicit email, runs the JWT-Bearer exchange, and
 * (for the host owner) persists the token + email in
 * `~/.eve/secrets.json`. For non-owners the token is returned in the
 * response body; the browser stores it in `localStorage.synap:pods`.
 *
 * Body: `{ "email": "alice@example.com" }`
 *
 *   • `email` — the operator email to mint a pod session for. Must
 *               exist on the pod as a human user with a Kratos
 *               identity.
 *
 * Returns:
 *   200 `{ ok: true, role: "owner",  token, expiresAt, user }` — owner path,
 *                                                                token persisted to disk.
 *   200 `{ ok: true, role: "member", token, expiresAt, user }` — non-owner,
 *                                                                token in body only.
 *   400 invalid email
 *   401 not signed in to local Eve dashboard
 *   503 misconfigured (no pod URL or no Eve external URL)
 *   <upstream-status> exchange failed (issuer not approved, user not
 *   found, JWT signature failure, etc.)
 *
 * ──────────────────────────────────────────────────────────────────────
 * First-write-wins disk model
 * ──────────────────────────────────────────────────────────────────────
 *
 * `~/.eve/secrets.json` is mode 0600 and tied to the host owner — the
 * uid that owns the file is the only one that can read it. The
 * dashboard process runs as that uid, so anything we write to disk is
 * effectively shared with the on-host CLI under the same uid.
 *
 * Persisting another user's pod token there would silently grant the
 * host owner access to that user's pod session. So we split:
 *
 *   • First sign-in on this Eve (no `pod.userToken` on disk yet) →
 *     this user becomes the host owner. Token persists to disk
 *     (`pod.userToken` slot). Subsequent `/api/pod/*` calls auto-renew
 *     from disk.
 *   • Any subsequent sign-in (slot already populated) → token lives in
 *     the response body only. The browser stores it in the
 *     `localStorage.synap:pods` map keyed by pod URL. The disk slot is
 *     NOT touched.
 *
 * This is intentionally **orthogonal to CP identity**. A user may have
 * a CP account, no CP account, or be the host owner without a CP
 * account at all. Disk ownership is about who first claimed the slot
 * on this Eve install — nothing more. CP auth state is a separate
 * concern owned by `cp.userSession` and managed by `/api/auth/sync`.
 *
 * Backward compatibility: pre-1.1 installs that signed in on a freshly
 * provisioned Eve correctly land on the owner path (the slot is empty,
 * so the first signer wins). Multi-user installs that wrongly
 * persisted a second user's token under the old `cpToken` gate are
 * unaffected — the slot is already populated, so nothing changes.
 *
 * See: synap-team-docs/content/team/platform/eve-credentials.mdx §4
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { readPodUserToken } from "@eve/dna";
import { requireAuth } from "@/lib/auth-server";
import {
  mintAndStorePodUserToken,
  mintPodUserToken,
  PodSigninError,
} from "../../pod/_lib";

const BodySchema = z.object({
  email: z.string().min(1),
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

  // ── First-write-wins ownership detection ─────────────────────────────
  // Owner = whichever user first signed in on this Eve. We detect that
  // by reading the disk slot directly — if it's empty, this signer is
  // claiming it; otherwise we treat this as a member browser-only
  // sign-in and never touch disk.
  let isHostOwner = true;
  try {
    const existing = await readPodUserToken();
    if (existing && existing.token) {
      isHostOwner = false;
    }
  } catch {
    // Treat read failure as "no existing token" — the next write will
    // surface a real error if the disk is broken.
  }

  try {
    const minted = isHostOwner
      ? await mintAndStorePodUserToken(rawEmail, req.url, req.headers)
      : await mintPodUserToken(rawEmail, req.url, req.headers);

    return NextResponse.json({
      ok: true,
      role: isHostOwner ? "owner" : "member",
      // Owner path: token already on disk; we still echo it so the
      // browser can mirror it into `localStorage.synap:pods` without a
      // re-mint round-trip.
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
