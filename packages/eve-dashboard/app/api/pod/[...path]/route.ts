/**
 * `/api/pod/*` — catch-all USER channel proxy.
 *
 * Every operator-driven UI feature in Eve calls this proxy. The path
 * after `/api/pod/` is forwarded to the same path on the operator's
 * pod, with a `Bearer pod.userToken` attached. That token is a Kratos
 * session minted via the JWT-Bearer exchange (RFC 7523) — the operator
 * authenticates as themselves, not as the eve agent.
 *
 *   GET  /api/pod/trpc/proposals.list?input=...    → user inbox
 *   POST /api/pod/trpc/proposals.approve            → user approves
 *   GET  /api/pod/api/profile/me                    → user reads
 *
 * Refresh on 401: when the upstream rejects our cached token (Kratos
 * expired, key rotated server-side, etc.) we clear the cache, mint a
 * fresh assertion, exchange it, and retry ONCE. If the second call
 * also 401s the upstream response is returned unchanged so the UI can
 * surface the "sign in again" path.
 *
 * Auth carve-outs: a couple of public pod paths are routed through
 * `/api/pod/*` for URL aesthetics (Phase 5: `setup-status`,
 * `bootstrap-claim`). They live in dedicated route files at
 * `/api/pod/setup-status` and `/api/pod/bootstrap-claim` and Next's
 * routing prefers exact static segments over the catch-all, so this
 * handler is never reached for them. We do NOT special-case them
 * here — Next does it for free.
 *
 * Two-channel rule: never route a service action through here. The
 * proxy attaches the user-channel credential. Service actions belong
 * in `/api/hub/*`. See: synap-team-docs/content/team/platform/
 * eve-credentials.mdx.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-server";
import {
  clearPodUserToken,
  readEveSecrets,
  readPodUserToken,
  resolveSynapUrl,
} from "@eve/dna";
import {
  isTokenStillValid,
  mintAndStorePodUserToken,
  PodSigninError,
} from "../_lib";

interface RouteCtx {
  params: Promise<{ path: string[] }>;
}

// Headers we never forward upstream (browser-set or Eve-internal).
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
  // Authorization: we always set our own.
  "authorization",
]);

/**
 * Build the upstream URL by joining the catch-all segments and
 * preserving the original query string verbatim.
 */
function buildUpstreamUrl(podUrl: string, path: string[], req: NextRequest): string {
  const base = podUrl.replace(/\/+$/, "");
  const joined = path.map(encodeURIComponent).join("/");
  // Decode only the path separator so callers that supply pre-encoded
  // segments keep working. The encodeURIComponent above is the source
  // of truth for safety.
  const search = req.nextUrl.search; // includes leading `?` if non-empty
  return `${base}/${joined}${search}`;
}

/**
 * Resolve a usable user-token: try the cache first, mint on miss/expiry.
 * Returns the token plus a flag the caller uses to decide whether a
 * 401-retry is worth attempting (no point if we just minted).
 */
async function getUserToken(): Promise<
  | { ok: true; token: string; freshlyMinted: boolean }
  | { ok: false; status: number; body: Record<string, unknown> }
> {
  const secrets = await readEveSecrets();
  const cachedRaw = secrets?.pod;
  const userEmail = cachedRaw?.userEmail;

  // Hot path: cached token is still valid.
  const cached = await readPodUserToken();
  if (cached && isTokenStillValid(cached.expiresAt)) {
    return { ok: true, token: cached.token, freshlyMinted: false };
  }

  // Mint path: we know who the operator is from the cached email.
  // Without an email we can't sign an assertion (`sub` is required).
  // The dashboard surfaces this as "sign in to your pod" and prompts
  // for an email via /api/auth/pod-signin.
  if (!userEmail) {
    return {
      ok: false,
      status: 401,
      body: {
        error: "no-pod-session",
        action: "sign-in-required",
        message:
          "No pod user-session is cached. Sign in via POST /api/auth/pod-signin first.",
      },
    };
  }

  try {
    const minted = await mintAndStorePodUserToken(userEmail);
    return { ok: true, token: minted.token, freshlyMinted: true };
  } catch (err) {
    if (err instanceof PodSigninError) {
      return {
        ok: false,
        status: err.upstreamStatus,
        body: {
          error: err.code,
          message: err.message,
          ...(err.description ? { description: err.description } : {}),
        },
      };
    }
    return {
      ok: false,
      status: 500,
      body: {
        error: "mint_failed",
        message: err instanceof Error ? err.message : "Unknown error",
      },
    };
  }
}

/**
 * Forward the request — single shot. The retry loop in `proxy()`
 * decides whether to call this twice.
 */
async function forwardOnce(
  req: NextRequest,
  upstreamUrl: string,
  token: string,
  body: BodyInit | null,
): Promise<Response> {
  const headers = new Headers();
  req.headers.forEach((value, key) => {
    if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
      headers.set(key, value);
    }
  });
  // Kratos accepts both header forms; setting both is defensive.
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("X-Session-Token", token);
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

  const secrets = await readEveSecrets();
  const podUrl = resolveSynapUrl(secrets);
  if (!podUrl) {
    return NextResponse.json(
      { error: "no-pod-url", message: "Pod URL not configured." },
      { status: 503 },
    );
  }

  const params = await ctx.params;
  const path = params.path ?? [];
  const upstreamUrl = buildUpstreamUrl(podUrl, path, req);

  // Read the request body once — Node streams aren't reusable, so on
  // the rare retry path we replay the same buffer.
  let bodyBuf: ArrayBuffer | null = null;
  if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "DELETE") {
    bodyBuf = await req.arrayBuffer();
  }

  // First attempt.
  let tokenResolution = await getUserToken();
  if (!tokenResolution.ok) {
    return NextResponse.json(tokenResolution.body, {
      status: tokenResolution.status,
    });
  }

  let upstream: Response;
  try {
    upstream = await forwardOnce(
      req,
      upstreamUrl,
      tokenResolution.token,
      bodyBuf ? new Uint8Array(bodyBuf) : null,
    );
  } catch (err) {
    return NextResponse.json(
      {
        error: "pod_unreachable",
        message: err instanceof Error ? err.message : "Network error",
      },
      { status: 502 },
    );
  }

  // 401 retry path: clear the cached token, mint fresh, retry ONCE.
  // We skip the retry when we just minted — that means the new token
  // doesn't work either, so something else is wrong upstream.
  if (upstream.status === 401 && !tokenResolution.freshlyMinted) {
    await clearPodUserToken().catch(() => {
      /* best-effort — the next mint will overwrite anyway */
    });
    tokenResolution = await getUserToken();
    if (!tokenResolution.ok) {
      return NextResponse.json(tokenResolution.body, {
        status: tokenResolution.status,
      });
    }
    try {
      upstream = await forwardOnce(
        req,
        upstreamUrl,
        tokenResolution.token,
        bodyBuf ? new Uint8Array(bodyBuf) : null,
      );
    } catch (err) {
      return NextResponse.json(
        {
          error: "pod_unreachable",
          message: err instanceof Error ? err.message : "Network error",
        },
        { status: 502 },
      );
    }
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
