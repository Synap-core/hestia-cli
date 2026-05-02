import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-server";
import { getMessagingConfig, setMessagingConfig, type MessagingPlatform } from "@/lib/openclaw-config";

export async function GET() {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  return NextResponse.json(await getMessagingConfig());
}

export async function PUT(req: Request) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const body = (await req.json().catch(() => ({}))) as {
    enabled?: boolean;
    platform?: MessagingPlatform;
    /** Empty string clears; undefined preserves the existing token. */
    botToken?: string;
  };

  const next = await setMessagingConfig({
    enabled: Boolean(body.enabled),
    platform: body.platform,
    botToken: body.botToken,
  });

  return NextResponse.json({ ...next, restartNeeded: true });
}
