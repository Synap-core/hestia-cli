/**
 * POST /api/pod/kratos-auth
 *
 * Server-side proxy for Kratos self-service login and registration.
 *
 * WHY THIS EXISTS
 * ───────────────
 * The pod's Kratos public API (`/.ory/kratos/public/self-service/*`) is
 * unauthenticated by design (it IS the auth flow), but calling it from
 * the browser would require CORS allowlisting every possible Eve origin.
 * Instead we proxy here, call Kratos server-side, and return a clean
 * `{ ok, sessionToken, user }` envelope to the browser.
 *
 * On success the session token is persisted to
 * `~/.eve/secrets/secrets.json` (same slot as the JWT-Bearer flow) so
 * subsequent `/api/pod/*` proxy calls pick it up automatically.
 *
 * Body:
 *   { mode: "login" | "registration", email, password, name? }
 *
 * Returns:
 *   200 { ok: true, sessionToken, user: { id, email, name } }
 *   400 { error: "validation", messages: string[] }
 *   400 { error: "pod-url-not-configured" }
 *   401 { error: "Unauthorized" }          — eve-session missing
 *   502 { error: "pod-unreachable", detail }
 *   502 { error: "kratos-error", messages, status }
 */

import { NextResponse } from "next/server";
import { writePodUserToken } from "@eve/dna";
import { requireAuth } from "@/lib/auth-server";
import { createEveKratosClient } from "@/lib/eve-kratos-client";
import { getPodRuntimeContext } from "@/lib/pod-runtime-context";
import { DashboardApiException, toDashboardApiError } from "@/lib/pod-response-parsers";

export async function POST(req: Request) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  let mode: string;
  let email: string;
  let password: string;
  let name: string | undefined;

  try {
    const body = (await req.json()) as {
      mode?: unknown;
      email?: unknown;
      password?: unknown;
      name?: unknown;
    };
    mode = typeof body.mode === "string" ? body.mode : "";
    email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    password = typeof body.password === "string" ? body.password : "";
    name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : undefined;
  } catch {
    return NextResponse.json({ error: "invalid-body" }, { status: 400 });
  }

  if (!["login", "registration"].includes(mode)) {
    return NextResponse.json(
      { error: "validation", messages: ['mode must be "login" or "registration"'] },
      { status: 400 },
    );
  }
  if (!email) {
    return NextResponse.json(
      { error: "validation", messages: ["Email is required."] },
      { status: 400 },
    );
  }
  if (!password) {
    return NextResponse.json(
      { error: "validation", messages: ["Password is required."] },
      { status: 400 },
    );
  }

  const context = await getPodRuntimeContext(req);
  if (!context.podUrl || !context.kratosPublicUrl) {
    return NextResponse.json(
      { error: "pod-url-not-configured" },
      { status: 400 },
    );
  }

  const kratos = createEveKratosClient(context);
  let submitBody;
  try {
    submitBody = await kratos.submitPasswordAuth({
      mode: mode as "login" | "registration",
      email,
      password,
      name,
    });
  } catch (err) {
    const status = err instanceof DashboardApiException ? err.httpStatus : 502;
    return NextResponse.json(toDashboardApiError(err, "pod-unreachable"), { status });
  }

  const sessionToken = submitBody.session_token;
  if (!sessionToken) {
    return NextResponse.json(
      { error: "kratos-error", messages: ["Pod authenticated but returned no session token."] },
      { status: 502 },
    );
  }

  const expiresAt =
    submitBody.session?.expires_at ??
    new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  // Persist so the pod proxy picks it up automatically.
  try {
    await writePodUserToken(sessionToken, expiresAt, email);
  } catch {
    // Non-fatal — still return the token to the browser.
  }

  // Resolve user identity: for registration Kratos returns `identity.traits`,
  // for login we only have what's in the session (Kratos v0.x doesn't return
  // the full identity on login). Best-effort.
  const identity = submitBody.identity;
  const userEmail = identity?.traits?.email ?? email;
  const userName = identity?.traits?.name ?? identity?.id ?? "";

  return NextResponse.json({
    ok: true,
    sessionToken,
    expiresAt,
    user: {
      id: identity?.id ?? "",
      email: userEmail,
      name: userName,
    },
  });
}
