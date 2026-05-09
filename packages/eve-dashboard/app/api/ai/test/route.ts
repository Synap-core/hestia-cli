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

  const BUILTIN_BASE_URLS: Record<string, string> = {
    anthropic:  "https://api.anthropic.com",
    openai:     "https://api.openai.com",
    openrouter: "https://openrouter.ai/api",
    ollama:     "http://localhost:11434",
  };

  const rawBaseUrl = provider.baseUrl || BUILTIN_BASE_URLS[provider.id];
  if (!rawBaseUrl) {
    return NextResponse.json({ error: "Provider has no baseUrl" }, { status: 400 });
  }

  // For ollama, test /api/tags; for others, test /v1/models.
  const baseUrl = rawBaseUrl.replace(/\/v1$/, "");
  const testUrl = provider.id === "ollama"
    ? `${baseUrl}/api/tags`
    : `${baseUrl}/v1/models`;

  // Anthropic uses x-api-key header; everyone else uses Bearer.
  const authHeaders: Record<string, string> = provider.apiKey
    ? provider.id === "anthropic"
      ? { "x-api-key": provider.apiKey, "anthropic-version": "2023-06-01" }
      : { Authorization: `Bearer ${provider.apiKey}` }
    : {};

  const start = Date.now();
  try {
    const res = await fetch(testUrl, {
      headers: authHeaders,
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

    // Ollama /api/tags returns { models: [{ name }] }; others return { data: [{ id }] }.
    const data = await res.json() as {
      data?: Array<{ id: string }>;
      models?: Array<{ name: string }>;
    };
    const ids = data.data?.map(m => m.id) ?? data.models?.map(m => m.name) ?? [];
    return NextResponse.json({
      ok: true,
      latency: elapsed,
      modelCount: ids.length,
      models: ids.slice(0, 10),
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
