/**
 * POST /api/channels/test
 * Tests whether the saved bot token is valid by calling the platform's "getMe" equivalent.
 * Only Telegram is supported for now.
 * Body: { platform: "telegram" }
 */
import { NextResponse } from "next/server";
import { readEveSecrets } from "@eve/dna";
import { requireAuth } from "@/lib/auth-server";

export async function POST(req: Request) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const body = await req.json().catch(() => ({})) as { platform?: string };

  if (body.platform === "telegram") {
    const secrets = await readEveSecrets();
    const token = secrets?.channels?.telegram?.botToken;
    if (!token) return NextResponse.json({ ok: false, error: "No bot token saved" }, { status: 400 });
    try {
      const r = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
        signal: AbortSignal.timeout(8000),
      });
      const data = await r.json() as { ok: boolean; result?: { username?: string; first_name?: string } };
      if (data.ok && data.result) {
        return NextResponse.json({ ok: true, name: data.result.first_name, username: data.result.username });
      }
      return NextResponse.json({ ok: false, error: "Invalid token — check your bot token" }, { status: 400 });
    } catch {
      return NextResponse.json({ ok: false, error: "Could not reach Telegram" }, { status: 503 });
    }
  }

  if (body.platform === "discord") {
    const secrets = await readEveSecrets();
    const token = secrets?.channels?.discord?.botToken;
    if (!token) return NextResponse.json({ ok: false, error: "No bot token saved" }, { status: 400 });
    try {
      const r = await fetch("https://discord.com/api/v10/users/@me", {
        headers: { Authorization: `Bot ${token}` },
        signal: AbortSignal.timeout(8000),
      });
      if (r.ok) {
        const data = await r.json() as { username?: string; id?: string };
        return NextResponse.json({ ok: true, name: data.username, id: data.id });
      }
      if (r.status === 401) {
        return NextResponse.json({ ok: false, error: "Invalid token — check your bot token" }, { status: 400 });
      }
      return NextResponse.json({ ok: false, error: `Discord returned ${r.status}` }, { status: 400 });
    } catch {
      return NextResponse.json({ ok: false, error: "Could not reach Discord" }, { status: 503 });
    }
  }

  return NextResponse.json({ ok: false, error: "Platform not supported for testing" }, { status: 400 });
}
