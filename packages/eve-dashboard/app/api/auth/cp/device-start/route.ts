/**
 * `POST /api/auth/cp/device-start` — kick off an RFC 8628 device flow.
 *
 * Eve's server proxies the device-authorize call to the CP so the
 * browser never needs the CP origin (no CORS, no env-baked URL leaking
 * into the bundle). Returns the user_code + verification URL the
 * dashboard renders, plus the device_code which the **server** holds
 * to drive polling. The browser is told a polling token (a
 * server-generated handle) so it can ask /device-status without ever
 * knowing the device_code itself.
 *
 * The handle → device_code map lives on disk under
 * `~/.eve/secrets.json` (`cp.deviceFlow.<handle>` keyed). On a fresh
 * boot, in-flight flows are dropped — that's fine, they expire after
 * 15 min anyway.
 */

import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { readEveSecrets, writeEveSecrets } from "@eve/dna";
import { requireAuth } from "@/lib/auth-server";
import { CP_BASE_URL } from "@/lib/cp-base-url";

const CLIENT_ID = "eve-dashboard";
const SCOPES = "marketplace:read marketplace:install";

interface DeviceAuthResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

export async function POST() {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  let upstream: Response;
  try {
    upstream = await fetch(`${CP_BASE_URL}/oauth/device/authorize`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ client_id: CLIENT_ID, scope: SCOPES }),
      cache: "no-store",
    });
  } catch (e) {
    return NextResponse.json(
      {
        error: "cp_unreachable",
        message: e instanceof Error ? e.message : "Network error",
      },
      { status: 502 },
    );
  }

  if (!upstream.ok) {
    const text = await upstream.text();
    return new NextResponse(text, {
      status: upstream.status,
      headers: { "Content-Type": "application/json" },
    });
  }

  const body = (await upstream.json()) as DeviceAuthResponse;

  // The polling handle is opaque to the client — internally it indexes
  // `cp.deviceFlow.<handle>` on disk so subsequent /device-status calls
  // can resolve back to the device_code.
  const handle = crypto.randomBytes(16).toString("base64url");
  const expiresAt = Date.now() + body.expires_in * 1000;

  const secrets = await readEveSecrets();
  const now = Date.now();
  // Drop expired handles on every write to avoid accumulating stale entries.
  const existing = Object.fromEntries(
    Object.entries(secrets?.cp?.deviceFlow ?? {}).filter(
      ([, v]) => (v as { expiresAt: number }).expiresAt > now,
    ),
  );
  await writeEveSecrets({
    cp: {
      deviceFlow: {
        ...existing,
        [handle]: {
          deviceCode: body.device_code,
          expiresAt,
          interval: body.interval,
        },
      },
    },
  });

  return NextResponse.json(
    {
      handle,
      userCode: body.user_code,
      verificationUri: body.verification_uri,
      verificationUriComplete: body.verification_uri_complete,
      expiresIn: body.expires_in,
      interval: body.interval,
    },
    { status: 200 },
  );
}
