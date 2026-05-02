import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-server";
import { getVoiceConfig, setVoiceConfig, type VoiceProvider } from "@/lib/openclaw-config";

export async function GET() {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  return NextResponse.json(await getVoiceConfig());
}

export async function PUT(req: Request) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const body = (await req.json().catch(() => ({}))) as {
    enabled?: boolean;
    provider?: VoiceProvider;
    phoneNumber?: string;
    sipUri?: string;
  };

  const next = await setVoiceConfig({
    enabled: Boolean(body.enabled),
    provider: body.provider,
    phoneNumber: body.phoneNumber || undefined,
    sipUri: body.sipUri || undefined,
  });

  return NextResponse.json({ ...next, restartNeeded: true });
}
