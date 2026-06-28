/**
 * GET /api/pod/kratos-login
 *
 * Starts a Kratos browser-flow login. Redirects the browser to the pod's
 * Kratos login endpoint with `return_to` pointing back to our callback so
 * Eve can issue an `eve-session` JWT after successful authentication.
 *
 * Kratos routes the browser to pod-admin's login UI, handles credentials,
 * sets the parent-domain `ory_kratos_session` cookie, then follows
 * `return_to` back to /api/pod/kratos-callback.
 */

import { NextResponse } from "next/server";
import { getPodRuntimeContext } from "@/lib/pod-runtime-context";

export async function GET(req: Request) {
  const context = await getPodRuntimeContext(req);
  if (!context.kratosPublicUrl) {
    // No pod detected — use Host header if available, fall back to req.url.
    const host = req.headers.get("host");
    const proto = req.headers.get("x-forwarded-proto") || "https";
    const fallbackUrl = host ? `${proto}://${host}` : req.url;
    return NextResponse.redirect(new URL("/login?error=no-pod", fallbackUrl));
  }

  // Build the origin from Host header — same reason as kratos-callback.
  // req.url is the internal container address (http://0.0.0.0:3000) behind
  // a proxy; the Host header carries the external domain.
  const host = req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const baseUrl = host ? `${proto}://${host}` : req.url;
  const params = new URL(baseUrl).searchParams;
  const next = params.get("next") ?? "/";

  const origin = new URL(baseUrl).origin;
  // Kratos will redirect back to callback; pass `next` through so the
  // callback can send the user to their original destination.
  const callbackUrl = encodeURIComponent(
    `${origin}/api/pod/kratos-callback?next=${next}`,
  );
  const kratosLoginUrl = `${context.kratosPublicUrl}/self-service/login/browser?return_to=${callbackUrl}`;

  return NextResponse.redirect(kratosLoginUrl);
}
