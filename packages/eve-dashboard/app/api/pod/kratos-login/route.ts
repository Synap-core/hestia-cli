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
import { getPodRuntimeContext, resolveExternalBaseUrl } from "@/lib/pod-runtime-context";

export async function GET(req: Request) {
  const context = await getPodRuntimeContext(req);
  // Resolve the dashboard's external base from a reliable source (forwarded/Host
  // header only when routable, else the known eve.<domain> from secrets). The
  // Host header alone is unsafe: a proxy that doesn't preserve it leaves the
  // internal bind address (0.0.0.0:3000), which Kratos would then use as the
  // browser's `return_to` — bouncing the user to a dead URL after login.
  const baseUrl = resolveExternalBaseUrl(req, context);
  if (!context.kratosPublicUrl) {
    return NextResponse.redirect(new URL("/login?error=no-pod", baseUrl));
  }

  // Read `next` from the request's own query (baseUrl carries no query string).
  const next = new URL(req.url).searchParams.get("next") ?? "/";

  const origin = new URL(baseUrl).origin;
  // Kratos will redirect back to callback; pass `next` through so the
  // callback can send the user to their original destination.
  const callbackUrl = encodeURIComponent(
    `${origin}/api/pod/kratos-callback?next=${next}`,
  );
  const kratosLoginUrl = `${context.kratosPublicUrl}/self-service/login/browser?return_to=${callbackUrl}`;

  return NextResponse.redirect(kratosLoginUrl);
}
