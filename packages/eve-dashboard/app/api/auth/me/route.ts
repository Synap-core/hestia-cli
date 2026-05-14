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

import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth-server";
import { readEveSecrets, writeEveSecrets } from "@eve/dna";

export async function GET() {
  const auth = await getAuthUser();
  if ("error" in auth) return auth.error;

  let secrets = await readEveSecrets();
  const podUrl = secrets?.synap?.apiUrl ?? null;

  // Generate adminToken lazily so existing sessions don't need to re-login.
  const dashboardSecrets = (secrets as { dashboard?: { adminToken?: string } } | null)?.dashboard;
  if (!dashboardSecrets?.adminToken) {
    await writeEveSecrets({ dashboard: { adminToken: randomBytes(32).toString("hex") } });
    secrets = await readEveSecrets();
  }

  const hasAdminToken = !!(secrets as { dashboard?: { adminToken?: string } } | null)
    ?.dashboard?.adminToken;

  return NextResponse.json({
    ok: true,
    user: auth.user,
    podUrl,
    hasAdminToken,
  });
}
