/**
 * GET /api/pod/issuer-info
 *
 * Returns Eve's public issuer URL + JWKS URL. Used by the pairing
 * dialog when sign-in fails with `invalid_client` — the operator needs
 * to give these to their pod admin to approve Eve as a trusted issuer.
 *
 * No secrets — just the public URL the pod will fetch JWKS from. We
 * still gate on `requireAuth()` so anonymous internet doesn't probe
 * Eve installs for their domain hints.
 *
 * See: synap-team-docs/content/team/platform/eve-credentials.mdx §3
 */

import { NextResponse } from "next/server";
import { readEveSecrets } from "@eve/dna";
import { requireAuth } from "@/lib/auth-server";
import { resolveEveExternalUrl } from "../_lib";

export interface IssuerInfoResponse {
  issuerUrl: string | null;
  jwksUrl: string | null;
}

export async function GET() {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  let issuerUrl: string | null = null;
  try {
    const secrets = await readEveSecrets();
    issuerUrl = resolveEveExternalUrl(secrets);
  } catch {
    // Leave `issuerUrl = null`; the UI will render a "configure
    // dashboard URL" hint in that branch.
  }

  return NextResponse.json<IssuerInfoResponse>({
    issuerUrl,
    jwksUrl: issuerUrl
      ? `${issuerUrl.replace(/\/+$/, "")}/.well-known/jwks.json`
      : null,
  });
}
