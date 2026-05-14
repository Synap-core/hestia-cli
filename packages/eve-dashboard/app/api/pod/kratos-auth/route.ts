/**
 * POST /api/pod/kratos-auth
 *
 * Server-side proxy for Kratos self-service login and registration.
 *
 * WHY THIS EXISTS
 * ───────────────
 * The pod's Kratos public API (`/.ory/kratos/public/self-service/*`) is
 * unauthenticated by design (it IS the auth flow). We proxy here so the
 * browser never needs CORS allowances for every possible Eve origin.
 *
 * Cookie-only auth: on success we set the parent-domain
 * `ory_kratos_session` cookie so subsequent `/api/pod/*` proxy calls
 * forward it directly. Eve persists nothing; Kratos is the single
 * source of truth for the operator's identity.
 *
 * Body:
 *   { mode: "login" | "registration", email, password, name? }
 *
 * Returns:
 *   200 { ok: true, sessionToken, user: { id, email, name } }
 *   400 { error: "validation", messages: string[] }
 *   400 { error: "pod-url-not-configured" }
 *   502 { error: "pod-unreachable", detail }
 *   502 { error: "kratos-error", messages, status }
 */

import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { SignJWT } from "jose";
import { readEveSecrets, writeEveSecrets } from "@eve/dna";
import { createEveKratosClient } from "@/lib/eve-kratos-client";
import { getPodRuntimeContext } from "@/lib/pod-runtime-context";
import { DashboardApiException, toDashboardApiError } from "@/lib/pod-response-parsers";

export async function POST(req: Request) {
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

  // Resolve user identity: for registration Kratos returns `identity.traits`,
  // for login we only have what's in the session (Kratos v0.x doesn't return
  // the full identity on login). Best-effort.
  const identity = submitBody.identity;
  const userEmail = identity?.traits?.email ?? email;
  const userName = identity?.traits?.name ?? identity?.id ?? "";

  const response = NextResponse.json({
    ok: true,
    sessionToken,
    expiresAt,
    podUrl: context.podUrl,
    user: {
      id: identity?.id ?? "",
      email: userEmail,
      name: userName,
    },
  });

  // Set the Kratos session cookie at the parent domain so subsequent
  // `/api/pod/*` proxy calls (and any sibling Synap surface — pod-admin,
  // pod itself) see it. We mirror Kratos's own cookie shape: HttpOnly,
  // SameSite=Lax, Secure when the eve URL is HTTPS, scoped to the root
  // domain so it crosses the eve.<root>/pod-admin.<root>/pod.<root>
  // boundary.
  const cookieDomain = await resolveParentDomainForCookie();
  const expiresMs = Date.parse(expiresAt);
  const maxAgeSeconds = Number.isFinite(expiresMs)
    ? Math.max(0, Math.floor((expiresMs - Date.now()) / 1000))
    : 24 * 60 * 60;
  const isSecure = (context.eveUrl ?? "").startsWith("https://") ||
    (context.podUrl ?? "").startsWith("https://");
  const parts = [
    `ory_kratos_session=${sessionToken}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (isSecure) parts.push("Secure");
  if (cookieDomain) parts.push(`Domain=${cookieDomain}`);
  response.headers.set("Set-Cookie", parts.join("; "));

  // Auto-issue an eve-session JWT so the dashboard is immediately unlocked
  // after login — no separate "paste your key" step required. We generate
  // dashboard.secret on first login if it doesn't exist yet.
  const eveSession = await issueEveSessionCookie({
    uid: identity?.id ?? "",
    email: userEmail,
    isSecure,
  });
  if (eveSession) response.headers.append("Set-Cookie", eveSession);

  return response;
}

async function issueEveSessionCookie(opts: {
  uid: string;
  email: string;
  isSecure: boolean;
}): Promise<string | null> {
  try {
    const secrets = await readEveSecrets();
    let dashboardSecret = secrets?.dashboard?.secret;
    const updates: Record<string, unknown> = {};

    if (!dashboardSecret) {
      dashboardSecret = randomBytes(32).toString("hex");
      updates["secret"] = dashboardSecret;
    }

    // Generate a one-time admin key the pod owner retrieves via `eve auth token`.
    const existing = secrets as { dashboard?: { adminToken?: string } } | null | undefined;
    if (!existing?.dashboard?.adminToken) {
      updates["adminToken"] = randomBytes(32).toString("hex");
    }

    if (Object.keys(updates).length > 0) {
      await writeEveSecrets({ dashboard: updates });
    }

    const key = new TextEncoder().encode(dashboardSecret);
    const token = await new SignJWT({ sub: "eve-dashboard", uid: opts.uid, email: opts.email })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("48h")
      .sign(key);

    const parts = [
      `eve-session=${token}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      `Max-Age=${48 * 60 * 60}`,
    ];
    if (opts.isSecure) parts.push("Secure");
    return parts.join("; ");
  } catch {
    // Non-fatal — Kratos auth succeeded; eve-session is a convenience cache
    return null;
  }
}

/**
 * Best-effort root-domain resolution for the Set-Cookie `Domain=` attribute.
 *
 * The cookie must be visible to `eve.<root>`, `pod-admin.<root>`, and
 * `pod.<root>` simultaneously, which means setting `Domain=.<root>`. We
 * read the configured primary domain from secrets (the canonical source)
 * and fall back to undefined for loopback installs (where the cookie
 * remains scoped to the eve host — fine because eve and pod share that
 * host).
 */
async function resolveParentDomainForCookie(): Promise<string | undefined> {
  try {
    const secrets = await readEveSecrets();
    const primary = secrets?.domain?.primary?.trim();
    if (primary && primary !== "localhost") return `.${primary}`;
  } catch {
    /* fallthrough */
  }
  return undefined;
}
