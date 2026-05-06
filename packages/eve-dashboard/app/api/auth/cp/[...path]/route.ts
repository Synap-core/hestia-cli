/**
 * GET|POST|PUT|PATCH|DELETE /api/auth/cp/[...path]
 *
 * Generic server-side proxy for all Control Plane Better Auth requests.
 *
 * WHY THIS EXISTS
 * ───────────────
 * `@synap-core/auth` calls the CP API (https://api.synap.live) directly
 * from the browser. That works on *.synap.live origins (allowlisted in the
 * CP's `trustedOrigins`), but is blocked by CORS on external/custom domains
 * (e.g. eve.team.thearchitech.xyz).
 *
 * Solution: use `createProxyTransport` in `lib/synap-auth.ts` so all CP
 * calls are rewritten from `https://api.synap.live/…` to `/api/auth/cp/…`.
 * The browser makes a same-origin call; this route forwards it server-side
 * where CORS doesn't apply.
 *
 * SECURITY
 * ────────
 * • No Eve-level authentication is required — sign-in/sign-up are pre-auth
 *   by definition.
 * • We forward the original browser Origin header unchanged and set
 *   `x-forwarded-by: eve-dashboard`. The CP's `trustedOrigins` function
 *   trusts any HTTPS origin that arrives with that header, so custom Eve
 *   domains (e.g. eve.team.X) pass CSRF validation without being individually
 *   enrolled. Credentials (email+password) are what the CP actually validates.
 * • We strip the Forwarded/X-Forwarded-* headers that Next.js injects to
 *   avoid confusing the CP's rate-limiter.
 * • Sensitive response headers (set-cookie, www-authenticate) are forwarded
 *   unchanged — the CP may set its own cookies for SSO flows.
 * • The device-flow endpoints (/device-start, /device-status) are NOT caught
 *   here — they have their own handlers and Next.js routes specific paths
 *   before catch-alls.
 *
 * ROUTING
 * ───────
 * /api/auth/cp/auth/sign-in/email  → https://api.synap.live/auth/sign-in/email
 * /api/auth/cp/auth/sign-up/email  → https://api.synap.live/auth/sign-up/email
 * /api/auth/cp/auth/session        → https://api.synap.live/auth/session
 * /api/auth/cp/pods                → https://api.synap.live/pods
 * … and so on for any other CP path the auth client needs.
 *
 * See: synap-team-docs/content/team/platform/eve-auth-architecture.mdx
 *      lib/synap-auth.ts  (ProxyTransport wiring)
 */

import { type NextRequest, NextResponse } from "next/server";
import { CP_BASE_URL } from "@/lib/cp-base-url";

const STRIP_REQUEST_HEADERS = new Set([
  "host",
  // origin is forwarded unchanged — the CP's trustedOrigins trusts any
  // HTTPS origin that arrives with x-forwarded-by: eve-dashboard.
  "referer",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-port",
  "x-forwarded-proto",
  "x-real-ip",
]);

// Headers the CP sets that we should pass back to the browser.
const PASSTHROUGH_RESPONSE_HEADERS = [
  "content-type",
  "cache-control",
  "set-cookie",
  "www-authenticate",
  "retry-after",
  "x-request-id",
];

async function proxy(req: NextRequest, path: string[]): Promise<NextResponse> {
  const upstreamPath = path.join("/");
  const search = req.nextUrl.search ?? "";
  const upstreamUrl = `${CP_BASE_URL}/${upstreamPath}${search}`;

  // Build forwarded headers — copy what came in, strip hop-by-hop / infra headers.
  const forwardHeaders: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    if (!STRIP_REQUEST_HEADERS.has(key.toLowerCase())) {
      forwardHeaders[key] = value;
    }
  });
  // Identify ourselves as an Eve proxy. The CP's trustedOrigins function
  // trusts any HTTPS Origin that arrives with this header, so custom Eve
  // domains pass Better Auth's CSRF guard without individual enrollment.
  forwardHeaders["x-forwarded-by"] = "eve-dashboard";

  let body: BodyInit | undefined;
  if (req.method !== "GET" && req.method !== "HEAD") {
    body = await req.arrayBuffer();
  }

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: req.method,
      headers: forwardHeaders,
      body,
      // Never cache — auth endpoints must always be fresh.
      cache: "no-store",
      redirect: "manual",
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: "cp_unreachable",
        message: err instanceof Error ? err.message : "Network error reaching CP",
      },
      { status: 502 },
    );
  }

  // Stream the upstream body back to the browser.
  const responseBody = await upstream.arrayBuffer();

  const resHeaders = new Headers();
  for (const header of PASSTHROUGH_RESPONSE_HEADERS) {
    const value = upstream.headers.get(header);
    if (value) resHeaders.set(header, value);
  }

  return new NextResponse(responseBody, {
    status: upstream.status,
    headers: resHeaders,
  });
}

// ─── Route handlers ──────────────────────────────────────────────────────────

interface RouteContext {
  params: Promise<{ path: string[] }>;
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  const { path } = await ctx.params;
  return proxy(req, path);
}
export async function POST(req: NextRequest, ctx: RouteContext) {
  const { path } = await ctx.params;
  return proxy(req, path);
}
export async function PUT(req: NextRequest, ctx: RouteContext) {
  const { path } = await ctx.params;
  return proxy(req, path);
}
export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const { path } = await ctx.params;
  return proxy(req, path);
}
export async function DELETE(req: NextRequest, ctx: RouteContext) {
  const { path } = await ctx.params;
  return proxy(req, path);
}
