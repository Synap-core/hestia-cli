import { NextResponse } from "next/server";
import { readEveSecrets } from "@eve/dna";
import { requireAuth } from "@/lib/auth-server";

export interface RegisterIntegrationRequest {
  serviceId: string;
  nangoProvider: string;
  clientId: string;
  clientSecret: string;
  scopes: string;
}

export async function POST(req: Request) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const body = await req.json() as RegisterIntegrationRequest;
  const { serviceId, nangoProvider, clientId, clientSecret, scopes } = body;

  if (!clientId?.trim() || !clientSecret?.trim()) {
    return NextResponse.json({ error: "Client ID and Client Secret are required" }, { status: 400 });
  }

  const secrets = await readEveSecrets().catch(() => null);
  const nangoSecretKey = secrets?.connectors?.nango?.secretKey as string | undefined;
  if (!nangoSecretKey) {
    return NextResponse.json({ error: "Nango not configured" }, { status: 503 });
  }

  const nangoUrl = "http://eve-arms-nango:3003";
  const headers = {
    "Authorization": `Bearer ${nangoSecretKey}`,
    "Content-Type": "application/json",
  };

  const credentials = {
    type: "OAUTH2" as const,
    client_id: clientId.trim(),
    client_secret: clientSecret.trim(),
    scopes: scopes.trim() || undefined,
  };

  // Check if integration already exists to decide between POST and PATCH
  const existing = await fetch(`${nangoUrl}/integrations/${serviceId}`, {
    headers,
    signal: AbortSignal.timeout(5_000),
  }).catch(() => null);

  const isUpdate = existing?.ok;

  const res = await fetch(
    isUpdate ? `${nangoUrl}/integrations/${serviceId}` : `${nangoUrl}/integrations`,
    {
      method: isUpdate ? "PATCH" : "POST",
      headers,
      body: JSON.stringify(
        isUpdate
          ? { credentials }
          : { unique_key: serviceId, provider: nangoProvider, credentials }
      ),
      signal: AbortSignal.timeout(10_000),
    }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return NextResponse.json({ error: `Nango error: ${text}` }, { status: res.status });
  }

  return NextResponse.json({ ok: true });
}
