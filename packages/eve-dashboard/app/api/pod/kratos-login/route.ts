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
    return NextResponse.redirect(new URL("/login?error=no-pod", req.url));
  }

  const params = new URL(req.url).searchParams;
  const next = params.get("next") ?? "/";

  const origin = new URL(req.url).origin;
  // Kratos will redirect back to callback; pass `next` through so the
  // callback can send the user to their original destination.
  const callbackUrl = encodeURIComponent(
    `${origin}/api/pod/kratos-callback?next=${next}`,
  );
  const kratosLoginUrl = `${context.kratosPublicUrl}/self-service/login/browser?return_to=${callbackUrl}`;

  return NextResponse.redirect(kratosLoginUrl);
}
