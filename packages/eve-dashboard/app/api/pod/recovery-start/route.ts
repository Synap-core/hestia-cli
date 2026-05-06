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
import { readEveSecrets, resolveSynapUrl } from "@eve/dna";
import { requireAuth } from "@/lib/auth-server";

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

  const secrets = await readEveSecrets();
  const podUrl = resolveSynapUrl(secrets);
  if (!podUrl) {
    return NextResponse.json(
      { error: "pod-url-not-configured" },
      { status: 400 },
    );
  }
  const podBase = podUrl.replace(/\/+$/, "");
  const kratosBase = `${podBase}/.ory/kratos/public`;

  // ── Step 1: init the recovery/verification flow ─────────────────────────
  const flowEndpoint =
    mode === "password"
      ? `${kratosBase}/self-service/recovery/api`
      : `${kratosBase}/self-service/verification/api`;

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
        detail: `Kratos ${mode} flow init returned ${flowRes.status}`,
      },
      { status: 502 },
    );
  }

  const flow = (await flowRes.json().catch(() => null)) as { id?: string } | null;
  const flowId = flow?.id;
  if (!flowId) {
    return NextResponse.json(
      { error: "pod-unreachable", detail: "No flow id in Kratos response" },
      { status: 502 },
    );
  }

  // ── Step 2: submit the email to trigger the recovery/verification email ──
  const submitEndpoint =
    mode === "password"
      ? `${kratosBase}/self-service/recovery?flow=${flowId}`
      : `${kratosBase}/self-service/verification?flow=${flowId}`;

  let submitRes: Response;
  try {
    submitRes = await fetch(submitEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ method: "link", email }),
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

  if (!submitRes.ok) {
    const body = (await submitRes.json().catch(() => null)) as
      | { ui?: { messages?: Array<{ text: string; type: string }> } }
      | null;
    const msgs = body?.ui?.messages?.map((m) => m.text).filter(Boolean) ?? [];
    return NextResponse.json(
      { error: "kratos-error", messages: msgs, status: submitRes.status },
      { status: 422 },
    );
  }

  // Kratos sends the email on success (200). Return silently — the user
  // checks their inbox.
  return NextResponse.json({ ok: true });
}
