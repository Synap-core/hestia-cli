/**
 * GET /.well-known/jwks.json — Eve's JWT issuer JWKS publication.
 *
 * The pod's `/api/hub/auth/exchange` endpoint fetches this URL to verify
 * the signature on assertions Eve mints (RFC 7523 JWT-Bearer Grant). The
 * pod's `verifyCpJwt` helper expects exactly the standard shape:
 *
 *   { "keys": [{ <JWK fields...>, "kid", "use", "alg" }] }
 *
 * This route is INTENTIONALLY UNAUTHENTICATED. It only ever serves the
 * public half of the keypair — there is nothing here that needs gating.
 * `requireAuth()` would defeat the purpose: the pod can't sign in to Eve.
 *
 * Next.js note: serving a path that contains a literal dot inside a
 * segment (`jwks.json`) works because we use a folder-as-segment with
 * `route.ts` inside. The file system path is `app/.well-known/jwks.json/
 * route.ts`. Verified locally with Next 16.1.
 *
 * See: synap-team-docs/content/team/platform/eve-credentials.mdx §4
 */

import { NextResponse } from "next/server";
import { ensurePodIssuer } from "@eve/dna";

export async function GET() {
  // ensurePodIssuer is idempotent — returns the existing keypair on
  // every call after the first generation. We do this lazily on the
  // first JWKS hit so a fresh install doesn't have to remember to run
  // any explicit "init keypair" step.
  let issuer;
  try {
    issuer = await ensurePodIssuer();
  } catch (err) {
    return NextResponse.json(
      {
        error: "issuer_init_failed",
        message:
          err instanceof Error ? err.message : "could not generate keypair",
      },
      { status: 500 },
    );
  }

  // The publicJwk is whatever `jose.exportJWK(publicKey)` produces for
  // ES256 — typically `{ kty, crv, x, y }`. We layer the JWK metadata
  // (kid / use / alg) on top so verifiers don't have to guess.
  const publicJwk = issuer.publicJwk as Record<string, unknown>;
  const body = {
    keys: [
      {
        ...publicJwk,
        kid: issuer.kid,
        use: "sig",
        alg: "ES256",
      },
    ],
  };

  return new NextResponse(JSON.stringify(body), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      // 5 min — short enough that a key rotation propagates fast,
      // long enough that we don't hammer this route on every JWT
      // verify on the pod side.
      "Cache-Control": "public, max-age=300",
    },
  });
}
