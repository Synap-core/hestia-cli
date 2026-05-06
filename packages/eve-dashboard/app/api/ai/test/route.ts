/**
 * Test provider connectivity.
 *
 * POST /api/ai/test
 * Body: { providerId: string }
 *
 * Attempts to reach the provider's baseUrl and fetch available models.
 * Returns: { ok, latency, modelCount, models: [...], error? }
 */
import { NextResponse } from "next/server";
import { readEveSecrets } from "@eve/dna";
import { requireAuth } from "@/lib/auth-server";

export async function POST(req: Request) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const body = await req.json().catch(() => ({})) as { providerId?: string };
  if (!body.providerId) {
    return NextResponse.json({ error: "Missing providerId" }, { status: 400 });
  }

  const secrets = await readEveSecrets();
  const provider = (secrets?.ai?.providers ?? []).find(p => p.id === body.providerId);
  if (!provider) {
    return NextResponse.json({ error: "Provider not found" }, { status: 404 });
  }

  if (!provider.baseUrl) {
    return NextResponse.json({ error: "Provider has no baseUrl" }, { status: 400 });
  }

  // For ollama, test /api/tags; for others, test /v1/models.
  const baseUrl = provider.baseUrl.replace(/\/v1$/, "");
  const testUrl = provider.id === "ollama"
    ? `${baseUrl}/api/tags`
    : `${baseUrl}/v1/models`;

  const start = Date.now();
  try {
    const res = await fetch(testUrl, {
      headers: provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {},
      signal: AbortSignal.timeout(10_000),
    });
    const elapsed = Date.now() - start;

    if (!res.ok) {
      return NextResponse.json({
        ok: false,
        latency: elapsed,
        error: `HTTP ${res.status}: ${res.statusText}`,
      });
    }

    const data = await res.json() as { data?: Array<{ id: string }> };
    return NextResponse.json({
      ok: true,
      latency: elapsed,
      modelCount: data.data?.length ?? 0,
      models: (data.data ?? []).slice(0, 10).map(m => m.id),
    });
  } catch (err) {
    const elapsed = Date.now() - start;
    return NextResponse.json({
      ok: false,
      latency: elapsed,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
