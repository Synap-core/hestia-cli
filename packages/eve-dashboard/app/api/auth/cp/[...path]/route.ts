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
  "www-authenticate",
  "retry-after",
  "x-request-id",
];
// set-cookie is handled separately via getSetCookie() — Headers.set() collapses
// multiple Set-Cookie directives into one (violating RFC 6265).

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
  // Identify ourselves as an Eve proxy so the CP's trustedOrigins function
  // can trust requests from custom Eve domains without individual enrollment.
  // Only set on requests that are actually coming from this dashboard origin
  // — spoofing this header from an arbitrary third party would allow them
  // to bypass CSRF; we only trust it when the Origin matches ourselves.
  const requestOrigin = req.headers.get("origin") ?? "";
  const dashboardOrigin = req.nextUrl.origin;
  if (!requestOrigin || requestOrigin === dashboardOrigin) {
    forwardHeaders["x-forwarded-by"] = "eve-dashboard";
  }

  let body: BodyInit | undefined;
  if (req.method !== "GET" && req.method !== "HEAD") {
    const rawBody = await req.arrayBuffer();
    body = await injectReturnToken(path, req.method, rawBody);
    // If the body was rewritten (JSON injection), update Content-Type and
    // drop Content-Length — the proxy sets it from the new body length.
    if (body !== rawBody) {
      forwardHeaders["content-type"] = "application/json";
      delete forwardHeaders["content-length"];
    }
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
  // Forward all Set-Cookie directives individually.
  const cookies = (upstream.headers as Headers & { getSetCookie?(): string[] }).getSetCookie?.()
    ?? (upstream.headers.get("set-cookie") ? [upstream.headers.get("set-cookie")!] : []);
  for (const cookie of cookies) {
    resHeaders.append("set-cookie", cookie);
  }

  return new NextResponse(responseBody, {
    status: upstream.status,
    headers: resHeaders,
  });
}

// ─── Sign-in / sign-up body injection ────────────────────────────────────────
//
// Better Auth sets a session cookie on browser-based sign-in, but only
// includes the bearer token in the response body when `returnToken: true`
// is passed in the request. Without it, `data.token` is `undefined` on the
// client, which means `CPSession.token = ""` — an empty string that causes
// `readCpUserSession()` to return null (it requires a truthy token) and the
// pod claim flow to fail with `cp-session-required`.
//
// We inject the flag server-side so the CP always echoes the token in the
// JSON response, regardless of whether the caller remembered to include it.

const TOKEN_INJECT_PATHS = new Set([
  "auth/sign-in/email",
  "auth/sign-up/email",
]);

async function injectReturnToken(
  path: string[],
  method: string,
  rawBody: ArrayBuffer,
): Promise<BodyInit> {
  const upstreamPath = path.join("/");
  if (method !== "POST" || !TOKEN_INJECT_PATHS.has(upstreamPath)) {
    return rawBody;
  }
  try {
    const text = new TextDecoder().decode(rawBody);
    if (!text) return rawBody;
    const json = JSON.parse(text) as Record<string, unknown>;
    if (json.returnToken === true) return rawBody; // already set
    json.returnToken = true;
    return JSON.stringify(json);
  } catch {
    // Not JSON — forward as-is. CP will reject it with a proper error.
    return rawBody;
  }
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
