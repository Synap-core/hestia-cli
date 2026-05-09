/**
 * POST /api/pod/recovery-start
 *
 * Server-side proxy for Kratos self-service recovery (password reset).
 *
 * Kratos recovery sends an EMAIL to the user with a recovery link.
 * We proxy the Kratos recovery API calls so the browser never touches
 * the pod's public Kratos endpoints directly (avoids CORS).
 *
 * Body: { email, mode: "password" | "verification" }
 *
 * Returns:
 *   200 { ok: true }              — recovery/verification email sent
 *   400 { error: "email required" }
 *   400 { error: "pod-url-not-configured" }
 *   401 { error: "Unauthorized" }
 *   502 { error: "pod-unreachable", detail }
 */

import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-server";
import { createEveKratosClient } from "@/lib/eve-kratos-client";
import { getPodRuntimeContext } from "@/lib/pod-runtime-context";
import { DashboardApiException, toDashboardApiError } from "@/lib/pod-response-parsers";

export async function POST(req: Request) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  let email: string;
  let mode: string;

  try {
    const body = (await req.json()) as {
      email?: unknown;
      mode?: unknown;
    };
    email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    mode = typeof body.mode === "string" ? body.mode : "";
  } catch {
    return NextResponse.json({ error: "invalid-body" }, { status: 400 });
  }

  if (!email) {
    return NextResponse.json({ error: "email required" }, { status: 400 });
  }
  if (!["password", "verification"].includes(mode)) {
    return NextResponse.json(
      { error: 'mode must be "password" or "verification"' },
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
  try {
    await kratos.startRecovery(mode as "password" | "verification", email);
  } catch (err) {
    const status = err instanceof DashboardApiException ? err.httpStatus : 502;
    return NextResponse.json(toDashboardApiError(err, "pod-unreachable"), { status });
  }

  // Kratos sends the email on success (200). Return silently — the user
  // checks their inbox.
  return NextResponse.json({ ok: true });
}
