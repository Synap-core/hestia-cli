/**
 * Messaging bridge config endpoint.
 *
 * GET   /api/arms/messaging  → returns current messaging config (token masked)
 * PATCH /api/arms/messaging  → saves messaging config + recreates OpenClaw
 */

import { NextResponse } from "next/server";
import { readEveSecrets, writeEveSecrets, entityStateManager } from "@eve/dna";
import { runActionToCompletion } from "@eve/lifecycle";
import { requireAuth } from "@/lib/auth-server";

type MessagingPlatform = "telegram" | "discord" | "signal" | "matrix";
const VALID_PLATFORMS: MessagingPlatform[] = ["telegram", "discord", "signal", "matrix"];

function maskToken(token?: string): string | undefined {
  if (!token) return undefined;
  if (token.length <= 8) return "***";
  return `${token.slice(0, 6)}...${token.slice(-4)}`;
}

export async function GET() {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const secrets = await readEveSecrets();
  const messaging = secrets?.arms?.messaging ?? {};

  return NextResponse.json({
    enabled: messaging.enabled ?? false,
    platform: messaging.platform ?? null,
    hasToken: !!(messaging.botToken && messaging.botToken.trim().length > 0),
    tokenMasked: maskToken(messaging.botToken),
  });
}

export async function PATCH(req: Request) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const body = await req.json().catch(() => ({})) as {
    enabled?: boolean;
    platform?: MessagingPlatform | null;
    botToken?: string | null;
  };

  if (body.platform !== undefined && body.platform !== null && !VALID_PLATFORMS.includes(body.platform)) {
    return NextResponse.json({ error: `Invalid platform "${body.platform}"` }, { status: 400 });
  }

  const current = (await readEveSecrets())?.arms?.messaging ?? {};
  const next: Record<string, unknown> = { ...current };
  if (body.enabled !== undefined) next.enabled = body.enabled;
  if (body.platform !== undefined) next.platform = body.platform ?? undefined;
  if (body.botToken !== undefined) next.botToken = body.botToken ?? undefined;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await writeEveSecrets({ arms: { messaging: next as any } });

  // OpenClaw reads messaging env vars at `docker run` time — need recreate.
  let recreated: { outcome: string; summary: string } | null = null;
  try {
    const installed = await entityStateManager.getInstalledComponents();
    if (installed.includes("openclaw")) {
      const r = await runActionToCompletion("openclaw", "recreate");
      recreated = {
        outcome: r.ok ? "ok" : "failed",
        summary: r.ok ? "OpenClaw recreated with new messaging config" : (r.error ?? "recreate failed"),
      };
    }
  } catch { /* openclaw not installed or lifecycle threw */ }

  return NextResponse.json({ ok: true, recreated });
}
