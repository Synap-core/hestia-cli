/**
 * `POST /api/auth/cp/device-status` — poll a pending device flow.
 *
 * Body: `{ handle }` — the opaque handle issued by /device-start.
 *
 * Resolves the handle to its stored device_code, exchanges it at the
 * CP's /oauth/token endpoint, and:
 *
 *   • If the user has approved → persists the JWT to
 *     `~/.eve/secrets.json` under `cp.userToken` and returns
 *     `{ status: "approved" }`. The browser then refreshes the
 *     marketplace and the home page recognises the new token.
 *   • If still pending → returns `{ status: "pending", retryAfter }`.
 *   • If denied / expired → returns `{ status: "denied" | "expired" }`.
 *
 * The browser doesn't know the device_code, doesn't see the JWT — both
 * stay server-side. The only thing it polls with is the opaque handle.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { readEveSecrets, writeEveSecrets, writeCpUserSession } from "@eve/dna";
import { requireAuth } from "@/lib/auth-server";
import { CP_BASE_URL } from "@/lib/cp-base-url";

const CLIENT_ID = "eve-dashboard";
const DEVICE_CODE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";

const bodySchema = z.object({ handle: z.string().min(1) });

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  scope: string;
}

interface OAuthErrorResponse {
  error: string;
  error_description?: string;
}

export async function POST(req: Request) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", message: "handle required" },
      { status: 400 },
    );
  }

  const handle = parsed.data.handle;
  const secrets = await readEveSecrets();
  const flow = secrets?.cp?.deviceFlow?.[handle];
  if (!flow) {
    return NextResponse.json(
      { status: "expired", message: "Unknown handle — restart sign-in." },
      { status: 200 },
    );
  }
  if (flow.expiresAt < Date.now()) {
    await clearHandle(handle);
    return NextResponse.json(
      { status: "expired", message: "Code expired — restart sign-in." },
      { status: 200 },
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${CP_BASE_URL}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        grant_type: DEVICE_CODE_GRANT,
        device_code: flow.deviceCode,
        client_id: CLIENT_ID,
      }),
      cache: "no-store",
    });
  } catch (e) {
    return NextResponse.json(
      {
        status: "error",
        error: "cp_unreachable",
        message: e instanceof Error ? e.message : "Network error",
      },
      { status: 502 },
    );
  }

  // 200 → token. 400 → polling state (authorization_pending, slow_down,
  // access_denied, expired_token) per RFC 8628.
  if (upstream.ok) {
    const tokens = (await upstream.json()) as TokenResponse;
    const issuedAt = new Date().toISOString();

    // Decode the JWT exp for the expiresAt hint.
    let expiresAtIso: string | undefined;
    let subFromJwt = "";
    let emailFromJwt = "";
    try {
      const [, payloadB64] = tokens.access_token.split(".");
      const payload = JSON.parse(
        Buffer.from(payloadB64, "base64url").toString("utf-8"),
      ) as { exp?: number; sub?: string; email?: string };
      if (typeof payload.exp === "number") {
        expiresAtIso = new Date(payload.exp * 1000).toISOString();
      }
      if (typeof payload.sub === "string") subFromJwt = payload.sub;
      if (typeof payload.email === "string") emailFromJwt = payload.email;
    } catch {
      /* best-effort */
    }

    // Fetch the user's profile from CP so we can write a proper
    // cp.userSession with email + userId. The device flow access_token
    // is a marketplace-scoped JWT that typically lacks the `email` claim,
    // which causes readCpUserSession()'s legacy fallback to return null
    // and the claim step to fail with cp-session-required.
    let userId = subFromJwt;
    let email = emailFromJwt;
    let name: string | undefined;
    try {
      const meRes = await fetch(`${CP_BASE_URL}/auth/get-session`, {
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
          Accept: "application/json",
        },
        cache: "no-store",
      });
      if (meRes.ok) {
        const me = (await meRes.json()) as {
          user?: { id?: string; email?: string; name?: string };
        };
        if (typeof me.user?.id === "string" && me.user.id) userId = me.user.id;
        if (typeof me.user?.email === "string" && me.user.email) email = me.user.email;
        if (typeof me.user?.name === "string") name = me.user.name;
      }
    } catch {
      /* network blip — fall back to JWT claims */
    }

    if (userId && email) {
      // Write the full cp.userSession so readCpUserSession() finds it
      // in the primary slot without needing to decode the JWT.
      await writeCpUserSession({
        token: tokens.access_token,
        userId,
        email,
        name,
        expiresAt: expiresAtIso,
        issuedAt,
      });
    } else {
      // Fallback: at least write the legacy slot so older callers still
      // work; the claim route will fail at readCpUserSession() if the JWT
      // really has no identity claims, but that's an extreme edge case.
      await writeEveSecrets({
        cp: {
          userToken: tokens.access_token,
          issuedAt,
          expiresAt: expiresAtIso,
        },
      });
    }

    await clearHandle(handle);
    return NextResponse.json({ status: "approved" }, { status: 200 });
  }

  const err = (await upstream.json().catch(() => ({}))) as OAuthErrorResponse;
  switch (err.error) {
    case "authorization_pending":
      return NextResponse.json(
        { status: "pending", retryAfter: flow.interval },
        { status: 200 },
      );
    case "slow_down":
      return NextResponse.json(
        { status: "pending", retryAfter: flow.interval + 5 },
        { status: 200 },
      );
    case "access_denied":
      await clearHandle(handle);
      return NextResponse.json({ status: "denied" }, { status: 200 });
    case "expired_token":
      await clearHandle(handle);
      return NextResponse.json({ status: "expired" }, { status: 200 });
    default:
      return NextResponse.json(
        {
          status: "error",
          error: err.error ?? "unknown",
          message: err.error_description ?? "Unexpected error",
        },
        { status: 502 },
      );
  }
}

async function clearHandle(handle: string) {
  const secrets = await readEveSecrets();
  const flows = { ...(secrets?.cp?.deviceFlow ?? {}) };
  delete flows[handle];
  await writeEveSecrets({
    cp: { deviceFlow: flows },
  });
}
