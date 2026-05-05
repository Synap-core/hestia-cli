/**
 * `GET /api/marketplace/apps` — server-side proxy to the CP marketplace.
 *
 * Why a proxy instead of calling the CP directly from the browser:
 *
 *   • CORS — self-hosted Eve at any custom domain (`eve.hyperray.shop`,
 *     `eve.example.com`, …) can't reach `api.synap.live` from the
 *     browser without per-tenant `Access-Control-Allow-Origin` config.
 *     Server-to-server has no CORS.
 *   • Token hygiene — the user JWT lives in `~/.eve/secrets.json` on
 *     the operator's machine. The browser never sees it after the
 *     initial write; it just calls this same-origin endpoint.
 *   • Future-proofing — when device flow / refresh tokens land we
 *     handle them all here, no client change.
 *
 * The CP endpoint uses optional auth: free apps come back with
 * `entitled: true` even without a bearer, so the public catalog
 * always renders. When a bearer is present it upgrades to
 * per-user entitlement.
 *
 * See: synap-team-docs/content/team/platform/eve-os-vision.mdx §6
 */

import { NextResponse } from "next/server";
import { readEveSecrets } from "@eve/dna";
import { requireAuth } from "@/lib/auth-server";
import { CP_BASE_URL } from "@/lib/cp-base-url";

export async function GET() {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  // Token is optional — CP returns the public catalog when omitted.
  const secrets = await readEveSecrets().catch(() => null);
  const token = secrets?.cp?.userToken?.trim();

  const headers = new Headers({ Accept: "application/json" });
  if (token) headers.set("Authorization", `Bearer ${token}`);

  let upstream: Response;
  try {
    upstream = await fetch(`${CP_BASE_URL}/api/marketplace/apps`, {
      method: "GET",
      headers,
      // The Eve server has full network egress; no need for CORS-bouncing
      // here. cache:'no-store' so per-user entitlements never get
      // mistakenly served to a different operator on the same host.
      cache: "no-store",
    });
  } catch (e) {
    return NextResponse.json(
      {
        error: "marketplace_unreachable",
        message: e instanceof Error ? e.message : "Network error",
      },
      { status: 502 },
    );
  }

  // Pass-through the upstream status + body. We don't try to parse the
  // body here — if the CP returns 401 we want the client to see 401.
  // Same for 5xx; the existing `useHomeApps` hook already maps statuses
  // to banner states.
  const text = await upstream.text();
  const responseHeaders = new Headers({
    "Content-Type":
      upstream.headers.get("content-type") ?? "application/json",
    "Cache-Control": "no-store",
  });
  return new NextResponse(text, {
    status: upstream.status,
    headers: responseHeaders,
  });
}
