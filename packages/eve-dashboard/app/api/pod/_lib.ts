/**
 * `/api/pod/*` — Eve's USER channel proxy helpers.
 *
 * The two-channel rule (see eve-credentials.mdx):
 *
 *   - `/api/pod/*`  → user actions. Authenticated with `pod.userToken`,
 *                     a Kratos session minted via JWT-Bearer exchange.
 *                     Use this for ANYTHING the operator does as
 *                     themselves: read inbox, approve a proposal, edit
 *                     a profile, mark a notification read.
 *   - `/api/hub/*`  → service actions. Authenticated with the eve agent
 *                     API key. Use this ONLY for genuinely agentic
 *                     things: agents submitting proposals on their own
 *                     behalf, OpenClaw skill round-trips, IS↔backend
 *                     memory writes.
 *
 * Mixing them lies to the audit log, gives human actions agent-level
 * RBAC scopes, and prevents future scope tightening. The proxy path
 * encodes the credential — pages don't pick credentials, they pick a
 * URL.
 *
 * This file owns the mint-and-store flow that fronts the user channel.
 */

import {
  ensurePodIssuer,
  readEveSecrets,
  resolveSynapUrl,
  writePodUserToken,
} from "@eve/dna";
import { SignJWT, importJWK, type JWK } from "jose";
import { randomBytes } from "node:crypto";

/** Result of a successful exchange. */
export interface PodSessionMint {
  token: string;
  /** ISO-8601. */
  expiresAt: string;
  /** The pod's view of the user we just signed in as. */
  user: { id: string; email: string; name: string | null };
}

/** Typed error so the catch-all proxy can map upstream OAuth errors back. */
export class PodSigninError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly upstreamStatus: number,
    readonly description?: string,
  ) {
    super(message);
    this.name = "PodSigninError";
  }
}

/**
 * Eve's external URL — the value we put in the JWT `iss` claim AND the
 * URL the pod will fetch JWKS from.
 *
 * Resolution order:
 *   1. `secrets.dashboard?.publicUrl` (if we ever start storing it).
 *   2. Derived `https://eve.${secrets.domain.primary}` when we have a
 *      domain. The standard install puts Eve at this subdomain.
 *   3. Loopback fallback `http://127.0.0.1:${port}` — only viable when
 *      the pod is also on the same loopback (single-machine dev).
 *
 * Returns `null` when none of these are usable; the caller should error
 * with a clear "configure dashboard URL" hint.
 */
export function resolveEveExternalUrl(
  secrets: Awaited<ReturnType<typeof readEveSecrets>>,
): string | null {
  const dash = secrets?.dashboard as { publicUrl?: string; port?: number } | undefined;
  const explicit = dash?.publicUrl?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");

  const domain = secrets?.domain?.primary?.trim();
  if (domain && domain !== "localhost") {
    const ssl = secrets?.domain?.ssl ?? false;
    return `${ssl ? "https" : "http"}://eve.${domain}`;
  }

  // Loopback dev — only useful when the pod runs on the same host.
  // The pod's JWKS fetch still has to resolve this URL, so an
  // out-of-host pod will fail until the operator configures a public
  // URL.
  const port = dash?.port ?? 7979;
  return `http://localhost:${port}`;
}

/**
 * Mint a fresh JWT-Bearer assertion, exchange it for a Kratos session,
 * and persist the result in `~/.eve/secrets.json`.
 *
 * Throws `PodSigninError` on every error path so the catch-all proxy
 * can surface a structured response to the dashboard UI.
 *
 * The `operatorEmail` MUST match a user that exists on the pod with
 * `userType: "human"` and a `kratosIdentityId`. The bootstrap path
 * (§5 in eve-credentials.mdx) creates that user; subsequent operators
 * are added via the invite flow.
 */
export async function mintAndStorePodUserToken(
  operatorEmail: string,
): Promise<PodSessionMint> {
  const email = operatorEmail.trim().toLowerCase();
  if (!email) {
    throw new PodSigninError(
      "operatorEmail is required",
      "invalid_request",
      400,
    );
  }

  const secrets = await readEveSecrets();
  const podUrl = resolveSynapUrl(secrets);
  if (!podUrl) {
    throw new PodSigninError(
      "Pod URL not configured",
      "no-pod-url",
      503,
    );
  }
  const eveUrl = resolveEveExternalUrl(secrets);
  if (!eveUrl) {
    throw new PodSigninError(
      "Eve external URL not configured",
      "no-eve-url",
      503,
    );
  }

  // Pod requires HTTPS issuer (`iss claim must be an HTTPS URL`). For
  // single-machine loopback dev we skip the strict check on the pod
  // side via PUBLIC_URL alignment; if the issuer is not HTTPS the
  // pod's `/auth/exchange` will reject with `invalid_grant`. Surface
  // that loud rather than silently rewriting the URL — the operator
  // needs to know they need a public Eve URL.

  const issuer = await ensurePodIssuer();

  // jose's importJWK returns a CryptoKey we can sign with. The JWK
  // shape is whatever `jose.exportJWK` produced for ES256 — we cast
  // through `unknown` because the on-disk persistence is `unknown`.
  const privateKey = await importJWK(
    issuer.privateJwk as unknown as JWK,
    "ES256",
  );

  const nowSec = Math.floor(Date.now() / 1000);
  const exp = nowSec + 240; // 4 min — well within pod's 5 min cap.
  const jti = randomBytes(16).toString("base64url");

  const assertion = await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: issuer.kid, typ: "JWT" })
    .setIssuer(eveUrl)
    .setSubject(email)
    .setAudience(podUrl.replace(/\/+$/, ""))
    .setIssuedAt(nowSec)
    .setExpirationTime(exp)
    .setJti(jti)
    .sign(privateKey);

  const exchangeUrl = `${podUrl.replace(/\/+$/, "")}/api/hub/auth/exchange`;
  let res: Response;
  try {
    res = await fetch(exchangeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
      cache: "no-store",
    });
  } catch (err) {
    throw new PodSigninError(
      err instanceof Error ? err.message : "pod unreachable",
      "pod_unreachable",
      502,
    );
  }

  if (!res.ok) {
    // RFC 6749 §5.2 envelope: `{ error, error_description? }`.
    const body = (await res.json().catch(() => null)) as
      | { error?: string; error_description?: string }
      | null;
    throw new PodSigninError(
      body?.error_description ?? body?.error ?? `Pod returned ${res.status}`,
      body?.error ?? "exchange_failed",
      res.status,
      body?.error_description,
    );
  }

  const data = (await res.json().catch(() => null)) as {
    access_token?: string;
    expires_in?: number;
    token_type?: string;
    scope?: string;
    user?: { id?: string; email?: string; name?: string | null };
  } | null;

  const accessToken = data?.access_token;
  const expiresIn = data?.expires_in ?? 86_400;
  const podUser = data?.user;
  if (!accessToken || !podUser?.id || !podUser.email) {
    throw new PodSigninError(
      "Pod responded with invalid envelope",
      "exchange_envelope_invalid",
      502,
    );
  }

  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
  await writePodUserToken(accessToken, expiresAt, podUser.email);

  return {
    token: accessToken,
    expiresAt,
    user: {
      id: podUser.id,
      email: podUser.email,
      name: podUser.name ?? null,
    },
  };
}

/**
 * Returns true when the cached token is still good. We give a 60-second
 * buffer so we don't hand out a token that's about to expire mid-flight.
 */
export function isTokenStillValid(expiresAt: string | undefined): boolean {
  if (!expiresAt) return false;
  const t = Date.parse(expiresAt);
  if (Number.isNaN(t)) return false;
  return t - Date.now() > 60_000;
}
