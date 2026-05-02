/**
 * AI provider config endpoint.
 *
 * GET   /api/ai          → returns providers, defaultProvider, fallbackProvider
 * PATCH /api/ai          → updates defaultProvider/fallbackProvider/mode
 */

import { NextResponse } from "next/server";
import { readEveSecrets, writeEveSecrets } from "@eve/dna";
import { requireAuth } from "@/lib/auth-server";

type ProviderId = "ollama" | "openrouter" | "anthropic" | "openai";

const VALID_PROVIDERS: ProviderId[] = ["ollama", "openrouter", "anthropic", "openai"];

function maskKey(key?: string): string | undefined {
  if (!key) return undefined;
  if (key.length <= 8) return "***";
  return `${key.slice(0, 7)}...${key.slice(-4)}`;
}

export async function GET() {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const secrets = await readEveSecrets();
  const ai = secrets?.ai ?? {};
  const providers = (ai.providers ?? []).map(p => ({
    id: p.id,
    enabled: p.enabled !== false,
    hasApiKey: !!(p.apiKey && p.apiKey.trim().length > 0),
    apiKeyMasked: maskKey(p.apiKey),
    baseUrl: p.baseUrl,
    defaultModel: p.defaultModel,
  }));

  return NextResponse.json({
    mode: ai.mode ?? null,
    defaultProvider: ai.defaultProvider ?? null,
    fallbackProvider: ai.fallbackProvider ?? null,
    providers,
    validProviders: VALID_PROVIDERS,
  });
}

export async function PATCH(req: Request) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const body = await req.json().catch(() => ({})) as {
    defaultProvider?: ProviderId;
    fallbackProvider?: ProviderId | null;
    mode?: "local" | "provider" | "hybrid";
  };

  if (body.defaultProvider && !VALID_PROVIDERS.includes(body.defaultProvider)) {
    return NextResponse.json({ error: "Invalid defaultProvider" }, { status: 400 });
  }
  if (body.fallbackProvider && !VALID_PROVIDERS.includes(body.fallbackProvider)) {
    return NextResponse.json({ error: "Invalid fallbackProvider" }, { status: 400 });
  }

  const next: Record<string, unknown> = {};
  if (body.defaultProvider !== undefined) next.defaultProvider = body.defaultProvider;
  if (body.fallbackProvider !== undefined) next.fallbackProvider = body.fallbackProvider ?? undefined;
  if (body.mode !== undefined) next.mode = body.mode;

  await writeEveSecrets({ ai: next as Parameters<typeof writeEveSecrets>[0]["ai"] });

  return NextResponse.json({ ok: true });
}
