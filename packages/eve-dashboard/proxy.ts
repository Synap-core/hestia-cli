import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

const PUBLIC_PATHS = new Set([
  "/login",
  "/api/pod/kratos-auth",
  "/api/pod/kratos-login",
  "/api/pod/kratos-callback",
  "/api/pod/setup-status",
]);

/**
 * If the browser has a `ory_kratos_session` cookie (set by Kratos browser
 * flow) but no valid eve-session, redirect to the callback so it can
 * validate the Kratos session and issue an eve-session JWT.
 *
 * This gives SSO for free: log into any pod surface (pod-admin, apps) and
 * Eve picks it up automatically.
 */
function redirectToKratosCallbackIfEligible(
  req: NextRequest,
): NextResponse | null {
  const kratosCookie = req.cookies.get("ory_kratos_session");
  if (!kratosCookie) return null;

  const callbackUrl = new URL(req.nextUrl);
  callbackUrl.pathname = "/api/pod/kratos-callback";
  // Preserve the original destination so the callback can redirect back
  // after issuing the eve-session.
  callbackUrl.searchParams.set("next", req.nextUrl.pathname + req.nextUrl.search);
  return NextResponse.redirect(callbackUrl);
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Allow public routes and static assets
  if (
    PUBLIC_PATHS.has(pathname) ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon")
  ) {
    return NextResponse.next();
  }

  const token = req.cookies.get("eve-session")?.value;

  if (!token) {
    // No eve-session — check if we can auto-SSO via Kratos browser cookie
    const ssoRedirect = redirectToKratosCallbackIfEligible(req);
    if (ssoRedirect) return ssoRedirect;

    // Nothing to work with — send to login
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = "/login";
    return NextResponse.redirect(loginUrl);
  }

  // We can't call readEveSecrets in middleware (Edge runtime) — instead we
  // embed the secret via an env var set by `eve ui` at startup.
  const dashboardSecret = process.env.EVE_DASHBOARD_SECRET;

  if (!dashboardSecret) {
    // No secret configured — fall through (API routes will handle it properly)
    return NextResponse.next();
  }

  try {
    const key = new TextEncoder().encode(dashboardSecret);
    await jwtVerify(token, key);
    return NextResponse.next();
  } catch {
    // Stale eve-session — try SSO before falling back to login
    const ssoRedirect = redirectToKratosCallbackIfEligible(req);
    if (ssoRedirect) return ssoRedirect;

    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = "/login";
    return NextResponse.redirect(loginUrl);
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
