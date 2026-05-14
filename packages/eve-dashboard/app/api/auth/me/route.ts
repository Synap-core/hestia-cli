/**
 * GET /api/auth/me
 *
 * Single source of truth for client-side auth state.
 * Verifies the eve-session JWT cookie and returns the user claims + pod URL.
 * Used by EveAccountGate to silently restore a session when localStorage
 * is empty but the cookie is still valid (e.g. after storage was cleared).
 *
 * 200 { ok: true, user: { uid, email }, podUrl: string | null }
 * 401 { ok: false }
 * 503 { ok: false } (dashboard not configured)
 */

import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth-server";
import { readEveSecrets } from "@eve/dna";

export async function GET() {
  const auth = await getAuthUser();
  if ("error" in auth) return auth.error;

  const secrets = await readEveSecrets();
  const podUrl = secrets?.synap?.apiUrl ?? null;
  // dashboard.secret is always present once `eve ui` has started.
  const hasAdminToken = !!secrets?.dashboard?.secret;

  return NextResponse.json({
    ok: true,
    user: auth.user,
    podUrl,
    hasAdminToken,
  });
}
