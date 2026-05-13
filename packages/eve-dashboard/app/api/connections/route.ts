import { NextResponse } from "next/server";
import { readEveSecrets, entityStateManager } from "@eve/dna";
import { requireAuth } from "@/lib/auth-server";

export interface ConnectionsState {
  nangoInstalled: boolean;
  nangoRunning: boolean;
  connectedApps: string[];
  /** Full OAuth redirect URI to paste into provider app settings. Null if no domain configured. */
  nangoCallbackUrl: string | null;
  registeredIntegrations: Array<{ key: string; provider: string; clientIdPreview: string }>;
}

export async function GET() {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const secrets = await readEveSecrets().catch(() => null);
  const nango = secrets?.connectors?.nango;

  let nangoInstalled = false;
  let nangoRunning = false;
  try {
    const state = await entityStateManager.getState();
    const installed = await entityStateManager.getInstalledComponents();
    nangoInstalled = installed.includes("nango");
    // Recorded state (may lag behind reality, but good enough for the banner)
    const entry = (state?.installed as Record<string, { state?: string }> | undefined)?.[
      "nango"
    ];
    nangoRunning = entry?.state === "ready";
  } catch {
    // state.json missing — fall back to secrets presence
    nangoInstalled = !!nango;
  }

  const connectedApps = Object.keys(
    (nango?.oauthApps as Record<string, unknown> | undefined) ?? {}
  );

  const domain = secrets?.domain?.primary as string | undefined;
  const ssl = secrets?.domain?.ssl !== false;
  const nangoCallbackUrl = domain
    ? `${ssl ? "https" : "http"}://nango.${domain}/oauth/callback`
    : null;

  let registeredIntegrations: Array<{ key: string; provider: string; clientIdPreview: string }> = [];
  if (nangoRunning) {
    const nangoSecretKey = secrets?.connectors?.nango?.secretKey as string | undefined;
    if (nangoSecretKey) {
      try {
        const r = await fetch("http://eve-arms-nango:3003/integrations", {
          headers: { Authorization: `Bearer ${nangoSecretKey}` },
          signal: AbortSignal.timeout(3000),
        });
        if (r.ok) {
          const data = await r.json() as { data?: Array<{ unique_key: string; provider: string }> };
          registeredIntegrations = (data.data ?? []).map(c => ({
            key: c.unique_key,
            provider: c.provider,
            clientIdPreview: "",
          }));
        }
      } catch { /* Nango may be starting */ }
    }
  }

  return NextResponse.json<ConnectionsState>({
    nangoInstalled,
    nangoRunning,
    connectedApps,
    nangoCallbackUrl,
    registeredIntegrations,
  });
}
