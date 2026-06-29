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
import { getPodRuntimeContext, resolveExternalBaseUrl } from "@/lib/pod-runtime-context";

export async function GET(req: Request) {
  const context = await getPodRuntimeContext(req);
  // Build the redirect base from a reliable source. The Host header alone is
  // NOT trustworthy: a reverse proxy that doesn't preserve it (Caddy fronting
  // the container) leaves us with the internal bind address (0.0.0.0:3000),
  // which is a dead URL for the browser. resolveExternalBaseUrl prefers a
  // routable forwarded/Host header, then the dashboard's known external URL
  // (eve.<domain>) from secrets.
  const baseUrl = resolveExternalBaseUrl(req, context);
  if (!context.kratosPublicUrl) {
    return NextResponse.redirect(new URL("/login?error=no-pod", baseUrl));
  }

  const rawCookies = req.headers.get("cookie") ?? "";
  const match = rawCookies.match(/(?:^|;\s*)ory_kratos_session=([^;]+)/);
  if (!match?.[1]) {
    return NextResponse.redirect(new URL("/login?error=no-session", baseUrl));
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
    return NextResponse.redirect(new URL("/login?error=kratos-unavailable", baseUrl));
  }

  if (!identity) {
    return NextResponse.redirect(new URL("/login?error=invalid-session", baseUrl));
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
    return NextResponse.redirect(new URL("/login?error=session-issue", baseUrl));
  }

  // Validate redirect target — must be a same-origin relative path
  // to prevent open-redirect attacks. Read `next` from the request's own query
  // (baseUrl carries no query string), so the post-login landing is preserved.
  const nextParam = new URL(req.url).searchParams.get("next") ?? "/";
  let safeRedirect = "/";
  try {
    const nextUrl = new URL(nextParam, baseUrl);
    if (nextUrl.origin === new URL(baseUrl).origin && nextUrl.pathname) {
      safeRedirect = nextUrl.pathname + nextUrl.search;
    }
  } catch {
    /* fall through to default "/" */
  }

  const response = NextResponse.redirect(new URL(safeRedirect, baseUrl));
  response.headers.set("Set-Cookie", eveSessionCookie);
  return response;
}
