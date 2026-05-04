import { NextResponse } from "next/server";
import { readEveSecrets, resolveSynapUrl } from "@eve/dna";
import { requireAuth } from "@/lib/auth-server";

export async function GET() {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  try {
    const secrets = await readEveSecrets();

    const providers = (secrets?.ai?.providers ?? []).map((p) => ({
      id: p.id,
      configured: true,
      hasKey: !!(p.apiKey && p.apiKey.trim().length > 0),
    }));

    const summary = {
      ai: {
        mode: secrets?.ai?.mode,
        defaultProvider: secrets?.ai?.defaultProvider,
        providers,
      },
      synap: {
        configured: !!resolveSynapUrl(secrets),
        hasApiKey: !!(secrets?.synap?.apiKey && secrets.synap.apiKey.trim().length > 0),
        apiUrl: resolveSynapUrl(secrets),
      },
      arms: {
        openclaw: {
          configured: !!(secrets?.arms?.openclaw?.synapApiKey),
        },
        messaging: {
          configured: !!(secrets?.arms?.messaging?.enabled && secrets?.arms?.messaging?.botToken),
        },
      },
    };

    return NextResponse.json(summary);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load secrets" },
      { status: 500 },
    );
  }
}
