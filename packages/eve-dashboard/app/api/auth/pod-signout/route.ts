/**
 * POST /api/auth/pod-signout — sign the operator out of the pod's Kratos
 * session.
 *
 * Cookie-only auth means there is no eve-side persisted token to clear.
 * Sign-out is a Kratos concern: we initiate a self-service browser
 * logout flow on the pod, return the `logout_url` so the browser can
 * navigate to it (which finalizes the logout and clears the
 * `ory_kratos_session` cookie at the parent domain), and clear the
 * cookie locally as a defensive measure.
 *
 * Returns:
 *   200 `{ ok: true, logoutUrl?: string }` — happy path.
 *   401 `{ error: "Unauthorized" }`        — eve-session missing.
 *   503 `{ error: "no-pod-url" }`           — pod URL not configured.
 *
 * See: synap-team-docs/content/team/platform/eve-credentials.mdx
 */

import { NextResponse } from "next/server";
import { readEveSecrets, resolvePodUrl } from "@eve/dna";
import { requireAuth } from "@/lib/auth-server";

interface KratosLogoutBrowserResponse {
  logout_url?: string;
  logout_token?: string;
}

function extractKratosSessionCookie(req: Request): string | null {
  const raw = req.headers.get("cookie");
  if (!raw) return null;
  const match = raw.match(/(?:^|;\s*)ory_kratos_session=([^;]+)/);
  return match ? match[1] : null;
}

export async function POST(req: Request) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const podUrl = await resolvePodUrl(undefined, req.url, req.headers);
  if (!podUrl) {
    return NextResponse.json({ error: "no-pod-url" }, { status: 503 });
  }
  const base = podUrl.replace(/\/+$/, "");

  // Ask Kratos for a browser-flow logout URL. We forward the inbound
  // cookie so Kratos can resolve which session to terminate. The flow
  // returns a one-shot URL the browser must navigate to.
  let logoutUrl: string | undefined;
  const sessionCookie = extractKratosSessionCookie(req);
  if (sessionCookie) {
    try {
      const flow = await fetch(
        `${base}/.ory/kratos/public/self-service/logout/browser`,
        {
          method: "GET",
          headers: {
            Accept: "application/json",
            Cookie: `ory_kratos_session=${sessionCookie}`,
          },
          cache: "no-store",
        },
      );
      if (flow.ok) {
        const body = (await flow.json().catch(() => null)) as
          | KratosLogoutBrowserResponse
          | null;
        if (body?.logout_url) logoutUrl = body.logout_url;
      }
    } catch {
      /* fall through — we still clear the cookie locally below */
    }
  }

  // Clear both Kratos session and Eve dashboard session cookies.
  // Doing it here ensures the local UI flips immediately even if the
  // browser doesn't follow the Kratos logout_url.
  const response = NextResponse.json({ ok: true, logoutUrl, redirectTo: "/login" });
  const cookieDomain = await resolveParentDomainForCookie();
  const isSecure = base.startsWith("https://");

  // `ory_kratos_session` was set with Domain=.<root> (parent domain) so it
  // must be cleared with the same Domain attribute.
  // `eve-session` was set WITHOUT a Domain attribute (host-scoped to eve.<root>)
  // so it must be cleared without one — a Domain mismatch silently fails.
  const makeExpiredCookie = (name: string, withDomain: boolean) => {
    const parts = [
      `${name}=`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      "Max-Age=0",
      "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    ];
    if (isSecure) parts.push("Secure");
    if (withDomain && cookieDomain) parts.push(`Domain=${cookieDomain}`);
    return parts.join("; ");
  };

  response.headers.set("Set-Cookie", makeExpiredCookie("ory_kratos_session", true));
  response.headers.append("Set-Cookie", makeExpiredCookie("eve-session", false));

  return response;
}

async function resolveParentDomainForCookie(): Promise<string | undefined> {
  try {
    const secrets = await readEveSecrets();
    const primary = secrets?.domain?.primary?.trim();
    if (primary && primary !== "localhost") return `.${primary}`;
  } catch {
    /* fallthrough */
  }
  return undefined;
}
