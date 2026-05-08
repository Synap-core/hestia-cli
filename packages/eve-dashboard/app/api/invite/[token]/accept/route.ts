/**
 * POST /api/invite/[token]/accept
 *
 * Public endpoint that hands the invitee off to the pod's Kratos
 * registration flow. The invitee has no Eve session and no pod session
 * yet — the pod owns signup, not Eve.
 *
 * We do NOT call `acceptInviteViaCp` from here: that procedure requires
 * a CP-issued JWT (an `invite-accept` token signed by the control plane)
 * which Eve cannot mint. Instead, we mirror the bootstrap-claim pattern
 * (Phase 5): produce a `signupUrl` pointing at the pod's registration
 * page with the invite + email pre-filled, and let the pod consume the
 * invite atomically as part of Kratos signup.
 *
 * Body (POST):
 *   { email: string }   — the canonical invite email, echoed back to
 *                          the pod for the registration form prefill.
 *                          Optional `password` and `name` are NOT
 *                          forwarded — Kratos owns those fields on its
 *                          own form. The invite page collects them only
 *                          to feel like a single-step signup; in v1
 *                          Kratos picks them up from its own UI.
 *
 * Returns:
 *   • 200 `{ signupUrl }`  — page navigates to the URL.
 *   • 503 `{ error }`      — no pod URL configured.
 *
 * No `requireAuth`: invitees have no Eve session at this point. The
 * token in the URL is the only capability and it gets passed straight
 * through to the pod's signup page.
 *
 * See: synap-team-docs/content/team/platform/eve-credentials.mdx §6
 */

import { NextResponse } from "next/server";
import { resolvePodUrl } from "@eve/dna";

interface AcceptBody {
  email?: unknown;
}

interface RouteCtx {
  params: Promise<{ token: string }>;
}

export async function POST(req: Request, ctx: RouteCtx) {
  const { token } = await ctx.params;
  if (!token || typeof token !== "string") {
    return NextResponse.json({ error: "missing token" }, { status: 400 });
  }

  const body = (await req.json().catch(() => null)) as AcceptBody | null;
  const email =
    body && typeof body.email === "string" ? body.email.trim().toLowerCase() : "";

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json(
      { error: "Valid email is required" },
      { status: 400 },
    );
  }

  let podUrl = "";
  try {
    podUrl = (await resolvePodUrl(undefined, req.url)) ?? "";
  } catch {
    // Falls through.
  }

  if (!podUrl) {
    return NextResponse.json({ error: "no-pod-url" }, { status: 503 });
  }

  const base = podUrl.replace(/\/+$/, "");
  // Same shape as bootstrap-claim. The `inviteToken` parameter is
  // additive — older pods that only consume `invite=<email>` ignore it
  // safely; newer pods can consume it atomically with Kratos signup.
  const signupUrl =
    `${base}/auth/registration` +
    `?invite=${encodeURIComponent(email)}` +
    `&inviteToken=${encodeURIComponent(token)}`;

  return NextResponse.json({ signupUrl, podUrl: base }, { status: 200 });
}
