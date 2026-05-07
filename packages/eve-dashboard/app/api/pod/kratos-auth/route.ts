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
import { readEveSecrets, resolveSynapUrl, writePodUserToken } from "@eve/dna";
import { requireAuth } from "@/lib/auth-server";

interface KratosFlow {
  id: string;
  ui?: {
    messages?: Array<{ text: string; type: string }>;
    nodes?: Array<{
      messages?: Array<{ text: string; type: string }>;
    }>;
  };
}

interface KratosSuccessLogin {
  session_token?: string;
  session?: { expires_at?: string };
}

interface KratosSuccessRegistration {
  session_token?: string;
  session?: { expires_at?: string };
  identity?: { id?: string; traits?: { email?: string; name?: string } };
}

/** Pull human-readable error strings from a Kratos UI envelope. */
function extractKratosMessages(flow: KratosFlow): string[] {
  const msgs: string[] = [];

  for (const m of flow.ui?.messages ?? []) {
    if (m.text) msgs.push(m.text);
  }
  for (const node of flow.ui?.nodes ?? []) {
    for (const m of node.messages ?? []) {
      if (m.text) msgs.push(m.text);
    }
  }

  return msgs.length ? msgs : ["Authentication failed. Check your credentials."];
}

/** Map verbose Kratos messages to user-friendly short versions. */
function friendlyMessages(raw: string[]): string[] {
  return raw.map((m) => {
    const lower = m.toLowerCase();
    if (
      lower.includes("provided credentials are invalid") ||
      lower.includes("invalid credentials") ||
      lower.includes("identifier or password")
    ) {
      return "Wrong email or password.";
    }
    if (lower.includes("already exists") || lower.includes("already registered")) {
      return "An account with that email already exists. Try signing in instead.";
    }
    if (lower.includes("password") && lower.includes("too short")) {
      return "Password is too short (minimum 8 characters).";
    }
    if (lower.includes("valid email")) {
      return "Enter a valid email address.";
    }
    return m;
  });
}

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

  const secrets = await readEveSecrets();
  const podUrl = resolveSynapUrl(secrets);
  if (!podUrl) {
    return NextResponse.json(
      { error: "pod-url-not-configured" },
      { status: 400 },
    );
  }

  // Traefik now routes `/.ory/*` via the stripprefix-kratos middleware
  // (added to match what Caddy already does implicitly in the standalone
  // setup). No need for Docker DNS hacks.
  const kratosBase = `${podUrl}/.ory/kratos/public`;

  // ── Step 1: init the self-service flow ───────────────────────────────────
  const flowEndpoint =
    mode === "login"
      ? `${kratosBase}/self-service/login/api`
      : `${kratosBase}/self-service/registration/api`;

  let flowRes: Response;
  try {
    flowRes = await fetch(flowEndpoint, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: "pod-unreachable",
        detail: err instanceof Error ? err.message : "Pod unreachable",
      },
      { status: 502 },
    );
  }

  if (!flowRes.ok) {
    return NextResponse.json(
      {
        error: "pod-unreachable",
        detail: `Kratos flow init returned ${flowRes.status}`,
      },
      { status: 502 },
    );
  }

  const flow = (await flowRes.json().catch(() => null)) as KratosFlow | null;
  const flowId = flow?.id;
  if (!flowId) {
    return NextResponse.json(
      { error: "pod-unreachable", detail: "No flow id in Kratos response" },
      { status: 502 },
    );
  }

  // ── Step 2: submit credentials ────────────────────────────────────────────
  const submitEndpoint =
    mode === "login"
      ? `${kratosBase}/self-service/login?flow=${flowId}`
      : `${kratosBase}/self-service/registration?flow=${flowId}`;

  const submitBody =
    mode === "login"
      ? { method: "password", identifier: email, password }
      : {
          method: "password",
          traits: { email, name: name ?? email.split("@")[0] },
          password,
        };

  let submitRes: Response;
  try {
    submitRes = await fetch(submitEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(submitBody),
      cache: "no-store",
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: "pod-unreachable",
        detail: err instanceof Error ? err.message : "Pod unreachable",
      },
      { status: 502 },
    );
  }

  const submitBody2 = (await submitRes.json().catch(() => null)) as
    | (KratosFlow & KratosSuccessLogin & KratosSuccessRegistration)
    | null;

  if (!submitRes.ok) {
    const rawMsgs = submitBody2 ? extractKratosMessages(submitBody2) : ["Authentication failed."];
    return NextResponse.json(
      {
        error: "kratos-error",
        messages: friendlyMessages(rawMsgs),
        status: submitRes.status,
      },
      { status: 422 },
    );
  }

  const sessionToken = submitBody2?.session_token;
  if (!sessionToken) {
    return NextResponse.json(
      { error: "kratos-error", messages: ["Pod authenticated but returned no session token."] },
      { status: 502 },
    );
  }

  const expiresAt =
    submitBody2?.session?.expires_at ??
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
  const identity = submitBody2?.identity;
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
