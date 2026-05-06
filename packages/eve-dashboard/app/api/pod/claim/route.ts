/**
 * POST /api/pod/claim — register the local Eve pod under the signed-in
 * user's CP account, then mint a pod-side Kratos session for them.
 *
 * Flow:
 *
 *   1. Verify the local Eve dashboard cookie (`eve-session`).
 *   2. Read the persisted CP user session (`cp.userSession`). Without
 *      one we can't claim — the browser must complete the CP sign-in
 *      flow first (POST /api/auth/sync).
 *   3. Resolve the local pod's external URL (Traefik / loopback).
 *   4. Call CP `POST /pods/handshake` with the user's CP token; CP
 *      returns an ES256 JWT scoped `aud=podUrl`.
 *   5. Forward that JWT to the pod's `POST /api/handshake`. The pod
 *      verifies via JWKS, mints a Kratos session, and returns
 *      `{ session_token }`.
 *   6. Persist the pod session via `writePodUserToken` (same slot
 *      `pod-signin/route.ts` writes to). Subsequent `/api/pod/*` calls
 *      use the cached token.
 *
 * Body: `{}` — no input. The user is implicit (cp.userSession), the
 * pod URL is implicit (host config).
 *
 * Returns:
 *   200 `{ ok: true, podUrl, podSessionExpiresAt }`
 *   400 `{ error: "pod-url-not-configured" }`
 *   401 `{ error: "Unauthorized" }`               — eve-session missing.
 *   401 `{ error: "cp-session-required" }`        — no valid CP session on disk.
 *   502 `{ error: "handshake-failed", detail }`   — CP unreachable / rejected.
 *   502 `{ error: "pod-exchange-failed", detail }` — pod handshake rejected.
 *   500 `{ error: "claim_failed", message }`      — anything else.
 *
 * See: synap-team-docs/content/team/platform/eve-credentials.mdx
 *      synap-team-docs/content/team/platform/eve-os-vision.mdx
 */

import { NextResponse } from "next/server";
import {
  readCpUserSession,
  resolveSynapUrl,
  readEveSecrets,
  writePodUserToken,
} from "@eve/dna";
import { requireAuth } from "@/lib/auth-server";
import { CP_BASE_URL } from "@/lib/cp-base-url";

interface CpHandshakeResponse {
  token?: string;
}

interface PodHandshakeResponse {
  success?: boolean;
  session_token?: string;
  session?: {
    expires_at?: string;
  };
}

export async function POST(req: Request) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const cpSession = await readCpUserSession();
  if (!cpSession) {
    return NextResponse.json(
      { error: "cp-session-required" },
      { status: 401 },
    );
  }

  // Caller may supply a candidate pod URL when secrets don't have one
  // (e.g. auto-detected from the Eve hostname). Fall back to secrets.
  let bodyPodUrl: string | undefined;
  try {
    const body = (await req.json().catch(() => null)) as
      | { podUrl?: unknown }
      | null;
    if (typeof body?.podUrl === "string" && body.podUrl.trim()) {
      bodyPodUrl = body.podUrl.trim();
      // Security: only HTTPS or loopback
      const u = new URL(bodyPodUrl);
      if (
        u.protocol !== "https:" &&
        !/^(localhost|127\.0\.0\.1|::1)$/.test(u.hostname)
      ) {
        return NextResponse.json(
          { error: "insecure-pod-url" },
          { status: 400 },
        );
      }
    }
  } catch {
    /* malformed URL — ignored, falls through to secrets lookup */
  }

  const secrets = await readEveSecrets();
  const podUrl = bodyPodUrl ?? resolveSynapUrl(secrets);
  if (!podUrl) {
    return NextResponse.json(
      { error: "pod-url-not-configured" },
      { status: 400 },
    );
  }
  const podBase = podUrl.replace(/\/+$/, "");

  // ── Step 1: ask CP to mint a handshake JWT scoped to this pod ────────
  let cpHandshakeRes: Response;
  try {
    cpHandshakeRes = await fetch(`${CP_BASE_URL}/pods/handshake`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${cpSession.token}`,
      },
      body: JSON.stringify({ targetUrl: podBase }),
      cache: "no-store",
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: "handshake-failed",
        detail: err instanceof Error ? err.message : "CP unreachable",
      },
      { status: 502 },
    );
  }

  if (!cpHandshakeRes.ok) {
    const detail = await cpHandshakeRes.text().catch(() => "");
    return NextResponse.json(
      {
        error: "handshake-failed",
        detail: detail.slice(0, 500) || `CP returned ${cpHandshakeRes.status}`,
        status: cpHandshakeRes.status,
      },
      { status: 502 },
    );
  }

  const cpHandshakeBody = (await cpHandshakeRes
    .json()
    .catch(() => null)) as CpHandshakeResponse | null;
  const handshakeJwt = cpHandshakeBody?.token;
  if (!handshakeJwt) {
    return NextResponse.json(
      {
        error: "handshake-failed",
        detail: "CP returned 200 but no token field",
      },
      { status: 502 },
    );
  }

  // ── Step 2: forward to pod /api/handshake to mint Kratos session ─────
  let podHandshakeRes: Response;
  try {
    podHandshakeRes = await fetch(`${podBase}/api/handshake`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        token: handshakeJwt,
        issuerUrl: CP_BASE_URL,
      }),
      cache: "no-store",
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: "pod-exchange-failed",
        detail: err instanceof Error ? err.message : "pod unreachable",
      },
      { status: 502 },
    );
  }

  if (!podHandshakeRes.ok) {
    const detail = await podHandshakeRes.text().catch(() => "");
    return NextResponse.json(
      {
        error: "pod-exchange-failed",
        detail: detail.slice(0, 500) || `pod returned ${podHandshakeRes.status}`,
        status: podHandshakeRes.status,
      },
      { status: 502 },
    );
  }

  const podHandshakeBody = (await podHandshakeRes
    .json()
    .catch(() => null)) as PodHandshakeResponse | null;
  const sessionToken = podHandshakeBody?.session_token;
  if (!sessionToken) {
    return NextResponse.json(
      {
        error: "pod-exchange-failed",
        detail: "pod returned 200 but no session_token",
      },
      { status: 502 },
    );
  }

  // Pod's /api/handshake doesn't return an ISO expiry directly — fall
  // back to a 24h window that matches the JWT-Bearer flow's default.
  // Kratos session lifetime is configured via env on the pod side; the
  // client refreshes opportunistically when a 401 surfaces.
  const expiresAt =
    podHandshakeBody?.session?.expires_at ??
    new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  try {
    await writePodUserToken(sessionToken, expiresAt, cpSession.email);
  } catch (err) {
    return NextResponse.json(
      {
        error: "claim_failed",
        message: err instanceof Error ? err.message : "Failed to persist token",
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    podUrl: podBase,
    podSessionExpiresAt: expiresAt,
  });
}
