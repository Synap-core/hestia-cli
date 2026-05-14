/**
 * POST /api/auth/admin-key
 *
 * Verify the admin key entered in the onboarding page.
 * On match, issues a new eve-session JWT with admin:true claim.
 *
 * Body: { token: string }
 * 200 { ok: true }
 * 400 { error: "missing-token" }
 * 401 { error: "invalid-token" }
 * 503 { error: "not-configured" }
 *
 * GET /api/auth/admin-key
 * Returns whether the current session has admin:true in its claims.
 * 200 { isAdmin: boolean, hasAdminToken: boolean }
 */

import { NextResponse } from "next/server";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { readEveSecrets } from "@eve/dna";
import { requireAuth, getAuthUser } from "@/lib/auth-server";

export async function GET() {
  const auth = await getAuthUser();
  if ("error" in auth) return auth.error;

  const cookieStore = await cookies();
  const token = cookieStore.get("eve-session")?.value;
  const secrets = await readEveSecrets();
  const dashboardSecret = secrets?.dashboard?.secret;
  const hasAdminToken = !!dashboardSecret;

  let isAdmin = false;
  if (token && dashboardSecret) {
    try {
      const key = new TextEncoder().encode(dashboardSecret);
      const { payload } = await jwtVerify(token, key);
      isAdmin = payload["admin"] === true;
    } catch {
      // token invalid — isAdmin stays false
    }
  }

  return NextResponse.json({ isAdmin, hasAdminToken });
}

export async function POST(req: Request) {
  const authCheck = await requireAuth();
  if ("error" in authCheck) return authCheck.error;

  const body = (await req.json().catch(() => ({}))) as { token?: string };
  if (!body.token?.trim()) {
    return NextResponse.json({ error: "missing-token" }, { status: 400 });
  }

  const secrets = await readEveSecrets();
  const dashboardSecret = secrets?.dashboard?.secret;

  if (!dashboardSecret) {
    return NextResponse.json({ error: "not-configured" }, { status: 503 });
  }

  // The admin key IS the dashboard secret — shown by `eve ui` at startup.
  if (body.token.trim() !== dashboardSecret) {
    return NextResponse.json({ error: "invalid-token" }, { status: 401 });
  }

  // Re-issue the eve-session JWT with admin:true
  const authUser = await getAuthUser();
  if ("error" in authUser) return authUser.error;

  const cookieStore = await cookies();
  const isSecure = (req.headers.get("x-forwarded-proto") ?? "http") === "https"
    || req.url.startsWith("https://");

  const key = new TextEncoder().encode(dashboardSecret);
  const newToken = await new SignJWT({
    sub: "eve-dashboard",
    uid: authUser.user.uid,
    email: authUser.user.email,
    admin: true,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("48h")
    .sign(key);

  const parts = [
    `eve-session=${newToken}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${48 * 60 * 60}`,
  ];
  if (isSecure) parts.push("Secure");

  const response = NextResponse.json({ ok: true });
  response.headers.set("Set-Cookie", parts.join("; "));
  return response;
}
