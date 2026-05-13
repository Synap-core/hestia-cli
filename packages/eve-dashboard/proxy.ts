import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

const PUBLIC_PATHS = new Set([
  "/login",
  "/api/pod/kratos-auth",
  "/api/pod/setup-status",
]);

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
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = "/login";
    return NextResponse.redirect(loginUrl);
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
