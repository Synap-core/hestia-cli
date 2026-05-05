/**
 * POST /api/auth/pod-signout — clear the cached pod user-session token.
 *
 * Doesn't touch `eve-session` (the local dashboard cookie) — that's
 * what `/api/auth/signout` handles. This endpoint is the inverse of
 * `/api/auth/pod-signin`: it deletes `pod.userToken`, leaving everything
 * else (including `pod.userEmail`) so the next sign-in is a single
 * click rather than a full email prompt.
 *
 * The next call to `/api/pod/*` will hit the catch-all proxy without a
 * cached token and 401 with `no-pod-session` if it can't auto-mint —
 * which is the expected behavior post-signout.
 *
 * See: synap-team-docs/content/team/platform/eve-credentials.mdx §4
 */

import { NextResponse } from "next/server";
import { clearPodUserToken } from "@eve/dna";
import { requireAuth } from "@/lib/auth-server";

export async function POST() {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  try {
    await clearPodUserToken();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      {
        error: "clear_failed",
        message: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
