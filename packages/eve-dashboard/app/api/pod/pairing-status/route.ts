/**
 * GET /api/pod/pairing-status
 *
 * Single source of truth for the dashboard UI to know whether the
 * operator has a usable pod session. The signal is the
 * `ory_kratos_session` cookie carried by the inbound browser request,
 * which we forward to the pod's `/.ory/kratos/public/sessions/whoami`
 * endpoint to confirm validity.
 *
 * States:
 *   • `unconfigured` — Eve doesn't know a pod URL yet
 *     (no `pod.url` and no `synap.apiUrl`)
 *   • `paired`       — Inbound cookie is present AND `whoami` returned
 *                      a valid session (200 with an identity payload).
 *   • `unpaired`     — Pod URL set, no inbound cookie or the cookie is
 *                      rejected. Operator needs to sign in via pod-admin.
 *
 * The token itself is NEVER returned. Only metadata the UI needs.
 *
 * See: synap-team-docs/content/team/platform/eve-credentials.mdx
 */

import { NextResponse } from "next/server";
import { resolvePodUrl } from "@eve/dna";
import { getAuthUser } from "@/lib/auth-server";

export type PairingStateApi = "unconfigured" | "unpaired" | "paired";

export interface PairingStatusResponse {
  state: PairingStateApi;
  /** Email from the eve-session JWT when paired. */
  userEmail?: string;
  /** Pod base URL (helpful diagnostic). */
  podUrl?: string;
}

function hasKratosSessionCookie(req: Request): boolean {
  const raw = req.headers.get("cookie");
  if (!raw) return false;
  return /(?:^|;\s*)ory_kratos_session=/.test(raw);
}

export async function GET(req: Request) {
  // Use getAuthUser so we have the email from the JWT without a
  // server-side Kratos call (which would fail from inside Docker due to
  // DNS — the public pod URL isn't reachable from within the container).
  const auth = await getAuthUser();
  if ("error" in auth) return auth.error;

  let podUrl: string | undefined;
  try {
    podUrl = await resolvePodUrl(undefined, req.url, req.headers);
  } catch {
    /* fall through — unconfigured */
  }

  if (!podUrl) {
    return NextResponse.json<PairingStatusResponse>({ state: "unconfigured" });
  }

  // ory_kratos_session cookie present = the browser has a live Kratos
  // session. Combined with a valid eve-session JWT (checked above), this
  // is sufficient to declare the pod paired — no server-side whoami
  // needed, and we avoid the Docker-internal DNS issue.
  if (!hasKratosSessionCookie(req)) {
    return NextResponse.json<PairingStatusResponse>({ state: "unpaired", podUrl });
  }

  return NextResponse.json<PairingStatusResponse>({
    state: "paired",
    userEmail: auth.user.email,
    podUrl,
  });
}
