/**
 * Discord bot connection routes — wraps the module-scoped Discord.js session
 * manager with a tiny HTTP API the Connect Channels modal can drive.
 *
 *   PUT /api/components/openclaw/discord
 *     body: { action: "init" | "disconnect" }
 *     returns: DiscordStatus
 *
 *   GET /api/components/openclaw/discord
 *     returns: DiscordStatus  (no mutation — used by the modal poller)
 *
 * Auth is the dashboard's normal `eve-session` JWT — the Discord session
 * itself is bound to the running Eve process, not the CP.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth-server";
import { initSession, getStatus, disconnect } from "./session-manager";

const bodySchema = z.object({
  action: z.enum(["init", "disconnect"]),
});

export async function GET() {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  return NextResponse.json(getStatus(), {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function PUT(req: Request) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_action", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  if (parsed.data.action === "init") {
    const status = await initSession();
    return NextResponse.json(status, {
      headers: { "Cache-Control": "no-store" },
    });
  }

  // action === "disconnect"
  await disconnect();
  return NextResponse.json(getStatus(), {
    headers: { "Cache-Control": "no-store" },
  });
}
