/**
 * `/api/pod/*` — catch-all USER channel proxy.
 *
 * Every operator-driven UI feature in Eve calls this proxy. The path
 * after `/api/pod/` is forwarded to the same path on the operator's
 * pod with the operator's authentication attached.
 *
 *   GET  /api/pod/trpc/proposals.list?input=...    → user inbox
 *   POST /api/pod/trpc/proposals.approve            → user approves
 *   GET  /api/pod/api/profile/me                    → user reads
 *
 * Auth: cookie-only. The operator signs in to pod-admin (or any other
 * parent-domain Synap surface) which sets the `ory_kratos_session`
 * cookie at `Domain=.<root>`. That cookie is visible to eve.<root>,
 * pod-admin.<root>, and pod.<root> simultaneously, so eve forwards it
 * verbatim to the pod and the pod's Kratos middleware does the rest.
 *
 * Eve persists nothing. There is no JWT-Bearer (RFC 7523) mint flow,
 * no `pod.userToken` slot in secrets.json, no JWKS to publish. Kratos
 * is the single source of truth.
 *
 * 401 handling: when the cookie is missing OR rejected upstream, we
 * surface a structured `{ error: "no-pod-session", action:
 * "sign-in-required" }` body so the dashboard UI knows to send the
 * operator through the pod-admin sign-in flow.
 *
 * Two-channel rule: never route a service action through here. The
 * proxy attaches the user-channel credential. Service actions belong
 * in `/api/hub/*`. See: synap-team-docs/content/team/platform/
 * eve-credentials.mdx.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-server";
import { resolvePodUrl } from "@eve/dna";

interface RouteCtx {
  params: Promise<{ path: string[] }>;
}

// Headers we never forward upstream (browser-set or Eve-internal).
// `cookie` and `authorization` are managed inside `forwardOnce` — `cookie`
// is replaced with a single `ory_kratos_session=…` value, `authorization`
// is dropped entirely (we never attach a bearer token here).
const HOP_BY_HOP_HEADERS = new Set([
  "host",
  "cookie",
  "connection",
  "content-length",
  "transfer-encoding",
  "keep-alive",
  "upgrade",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "authorization",
]);

/**
 * Extract the `ory_kratos_session` cookie from the inbound browser request.
 * Returns the full cookie value (the encrypted session token) or null.
 * This is the only auth signal the proxy uses.
 */
function extractKratosSessionCookie(req: NextRequest): string | null {
  const raw = req.headers.get("cookie");
  if (!raw) return null;
  const match = raw.match(/(?:^|;\s*)ory_kratos_session=([^;]+)/);
  return match ? match[1] : null;
}

/**
 * Build the upstream URL by joining the catch-all segments and
 * preserving the original query string verbatim.
 */
function buildUpstreamUrl(podUrl: string, path: string[], req: NextRequest): string {
  const base = podUrl.replace(/\/+$/, "");
  // Next.js App Router already URL-decodes dynamic segments before populating
  // params.path, so we must NOT re-encode them — that would double-encode any
  // already-percent-encoded characters (e.g. `foo%2Fbar` → `foo%252Fbar`).
  const joined = path.join("/");
  const search = req.nextUrl.search; // includes leading `?` if non-empty
  return `${base}/${joined}${search}`;
}

async function forwardOnce(
  req: NextRequest,
  upstreamUrl: string,
  sessionCookie: string,
  body: BodyInit | null,
): Promise<Response> {
  const headers = new Headers();
  req.headers.forEach((value, key) => {
    if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
      headers.set(key, value);
    }
  });

  // Forward only the Kratos session cookie. Other cookies in the
  // browser request belong to eve.<root> and would leak across origins.
  headers.set("Cookie", `ory_kratos_session=${sessionCookie}`);

  // We never want a CDN to cache user-scoped data.
  headers.set("Cache-Control", "no-store");

  return fetch(upstreamUrl, {
    method: req.method,
    headers,
    body,
    cache: "no-store",
    redirect: "manual",
  });
}

async function proxy(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const podUrl = await resolvePodUrl(undefined, req.url, req.headers)
  if (!podUrl) {
    return NextResponse.json(
      { error: "no-pod-url", message: "Pod URL not configured." },
      { status: 503 },
    );
  }

  const sessionCookie = extractKratosSessionCookie(req);
  if (!sessionCookie) {
    return NextResponse.json(
      {
        error: "no-pod-session",
        action: "sign-in-required",
        message:
          "No Kratos session cookie. Sign in to your pod (pod-admin) first.",
      },
      { status: 401 },
    );
  }

  const params = await ctx.params;
  const path = params.path ?? [];
  const upstreamUrl = buildUpstreamUrl(podUrl, path, req);

  const bodyBuf =
    req.method !== "GET" && req.method !== "HEAD" && req.method !== "DELETE"
      ? await req.arrayBuffer()
      : null;
  const replayBody = (): BodyInit | null =>
    bodyBuf ? new Uint8Array(bodyBuf) : null;

  let upstream: Response;
  try {
    upstream = await forwardOnce(req, upstreamUrl, sessionCookie, replayBody());
  } catch (err) {
    return NextResponse.json(
      {
        error: "pod_unreachable",
        message: err instanceof Error ? err.message : "Network error",
      },
      { status: 502 },
    );
  }

  // Forward the upstream response as-is. We preserve content-type,
  // status, and body bytes verbatim. Cache-Control is forced no-store
  // so a shared host doesn't cache user-scoped data.
  const respHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (
      lower === "content-encoding" ||
      lower === "transfer-encoding" ||
      lower === "connection"
    ) {
      return;
    }
    respHeaders.set(key, value);
  });
  respHeaders.set("Cache-Control", "no-store");

  const respBody = await upstream.arrayBuffer();
  return new NextResponse(respBody, {
    status: upstream.status,
    headers: respHeaders,
  });
}

export async function GET(req: NextRequest, ctx: RouteCtx) {
  return proxy(req, ctx);
}

export async function POST(req: NextRequest, ctx: RouteCtx) {
  return proxy(req, ctx);
}

export async function PUT(req: NextRequest, ctx: RouteCtx) {
  return proxy(req, ctx);
}

export async function PATCH(req: NextRequest, ctx: RouteCtx) {
  return proxy(req, ctx);
}

export async function DELETE(req: NextRequest, ctx: RouteCtx) {
  return proxy(req, ctx);
}
