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
import { requireAuth } from "@/lib/auth-server";

export type PairingStateApi = "unconfigured" | "unpaired" | "paired";

export interface PairingStatusResponse {
  state: PairingStateApi;
  /** Email pulled from the Kratos identity when paired. */
  userEmail?: string;
  /** Pod base URL (helpful diagnostic). */
  podUrl?: string;
  /** ISO-8601 expiry from the Kratos session, when available. */
  expiresAt?: string;
}

interface KratosWhoamiResponse {
  expires_at?: string;
  identity?: {
    traits?: {
      email?: string;
    };
  };
}

function extractKratosSessionCookie(req: Request): string | null {
  const raw = req.headers.get("cookie");
  if (!raw) return null;
  const match = raw.match(/(?:^|;\s*)ory_kratos_session=([^;]+)/);
  return match ? match[1] : null;
}

export async function GET(req: Request) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  let podUrl: string | undefined;
  try {
    podUrl = await resolvePodUrl(undefined, req.url, req.headers);
  } catch {
    // Fall through — `unconfigured` is the safest answer when we can't
    // resolve a pod URL.
  }

  if (!podUrl) {
    return NextResponse.json<PairingStatusResponse>({
      state: "unconfigured",
    });
  }

  const sessionCookie = extractKratosSessionCookie(req);
  if (!sessionCookie) {
    return NextResponse.json<PairingStatusResponse>({
      state: "unpaired",
      podUrl,
    });
  }

  // Probe Kratos `whoami` with the forwarded cookie. A 200 means the
  // session is live; anything else is treated as unpaired.
  const base = podUrl.replace(/\/+$/, "");
  try {
    const res = await fetch(`${base}/.ory/kratos/public/sessions/whoami`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Cookie: `ory_kratos_session=${sessionCookie}`,
      },
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json<PairingStatusResponse>({
        state: "unpaired",
        podUrl,
      });
    }
    const body = (await res.json().catch(() => null)) as KratosWhoamiResponse | null;
    return NextResponse.json<PairingStatusResponse>({
      state: "paired",
      userEmail: body?.identity?.traits?.email,
      podUrl,
      expiresAt: body?.expires_at,
    });
  } catch {
    // Pod unreachable — surface as unpaired so the UI nudges, rather
    // than blocking on an upstream blip.
    return NextResponse.json<PairingStatusResponse>({
      state: "unpaired",
      podUrl,
    });
  }
}
