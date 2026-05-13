import { NextResponse } from "next/server";
import { readEveSecrets } from "@eve/dna";
import { requireAuth } from "@/lib/auth-server";

export interface NangoInfo {
  installed: boolean;
  installedAt: string | null;
  secretKeyPresent: boolean;
  secretKeyPreview: string | null;
  oauthApps: string[];
}

export async function GET() {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const secrets = await readEveSecrets().catch(() => null);
  const nango = secrets?.connectors?.nango;

  if (!nango) {
    return NextResponse.json<NangoInfo>({
      installed: false,
      installedAt: null,
      secretKeyPresent: false,
      secretKeyPreview: null,
      oauthApps: [],
    });
  }

  const key = nango.secretKey as string | undefined;
  return NextResponse.json<NangoInfo>({
    installed: true,
    installedAt: (nango.installedAt as string | undefined) ?? null,
    secretKeyPresent: !!key,
    secretKeyPreview: key ? `${key.slice(0, 8)}${"•".repeat(16)}` : null,
    oauthApps: Object.keys((nango.oauthApps as Record<string, unknown>) ?? {}),
  });
}
