/**
 * GET /api/pod/kratos-callback
 *
 * Landing point after Kratos browser-flow login. Kratos sets the
 * `ory_kratos_session` cookie (Domain=.<root>) before redirecting here,
 * so the cookie is already in the browser by the time this handler runs.
 *
 * Steps:
 *   1. Extract the Kratos session cookie from the inbound request.
 *   2. Call Kratos whoami to get the operator identity.
 *   3. Issue an `eve-session` JWT so the dashboard is unlocked.
 *   4. Redirect to the dashboard root.
 *
 * Error redirects land on /login?error=<code> so the UI can surface a
 * human-readable message without exposing internals.
 */

import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { SignJWT } from "jose";
import { readEveSecrets, writeEveSecrets } from "@eve/dna";
import { getPodRuntimeContext } from "@/lib/pod-runtime-context";

export async function GET(req: Request) {
  const context = await getPodRuntimeContext(req);
  if (!context.kratosPublicUrl) {
    return NextResponse.redirect(new URL("/login?error=no-pod", req.url));
  }

  const rawCookies = req.headers.get("cookie") ?? "";
  const match = rawCookies.match(/(?:^|;\s*)ory_kratos_session=([^;]+)/);
  if (!match?.[1]) {
    return NextResponse.redirect(new URL("/login?error=no-session", req.url));
  }
  const sessionCookie = match[1];

  let identity: { id: string; traits: { email: string; name?: string } } | null = null;
  try {
    const whoami = await fetch(`${context.kratosPublicUrl}/sessions/whoami`, {
      headers: {
        Accept: "application/json",
        Cookie: `ory_kratos_session=${sessionCookie}`,
      },
      cache: "no-store",
    });
    if (whoami.ok) {
      const session = (await whoami.json().catch(() => null)) as {
        identity?: { id: string; traits: { email: string; name?: string } };
      } | null;
      identity = session?.identity ?? null;
    }
  } catch {
    return NextResponse.redirect(new URL("/login?error=kratos-unavailable", req.url));
  }

  if (!identity) {
    return NextResponse.redirect(new URL("/login?error=invalid-session", req.url));
  }

  let eveSessionCookie: string | null = null;
  try {
    const secrets = await readEveSecrets();
    let dashboardSecret = secrets?.dashboard?.secret;
    const updates: Record<string, unknown> = {};
    if (!dashboardSecret) {
      dashboardSecret = randomBytes(32).toString("hex");
      updates["secret"] = dashboardSecret;
    }
    if (!secrets?.dashboard?.adminToken) {
      updates["adminToken"] = randomBytes(32).toString("hex");
    }
    if (Object.keys(updates).length > 0) {
      await writeEveSecrets({ dashboard: updates });
    }

    const key = new TextEncoder().encode(dashboardSecret);
    const token = await new SignJWT({
      sub: "eve-dashboard",
      uid: identity.id,
      email: identity.traits.email,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("48h")
      .sign(key);

    const isSecure = (context.eveUrl ?? "").startsWith("https://");
    const parts = [
      `eve-session=${token}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      `Max-Age=${48 * 60 * 60}`,
    ];
    if (isSecure) parts.push("Secure");
    eveSessionCookie = parts.join("; ");
  } catch {
    return NextResponse.redirect(new URL("/login?error=session-issue", req.url));
  }

  // Validate redirect target — must be a same-origin relative path
  // to prevent open-redirect attacks.
  const nextParam = new URL(req.url).searchParams.get("next") ?? "/";
  let safeRedirect = "/";
  try {
    const nextUrl = new URL(nextParam, req.url);
    if (nextUrl.origin === new URL(req.url).origin && nextUrl.pathname) {
      safeRedirect = nextUrl.pathname + nextUrl.search;
    }
  } catch {
    /* fall through to default "/" */
  }

  const response = NextResponse.redirect(new URL(safeRedirect, req.url));
  response.headers.set("Set-Cookie", eveSessionCookie);
  return response;
}
