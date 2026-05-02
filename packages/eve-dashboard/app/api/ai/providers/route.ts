/**
 * AI providers CRUD.
 *
 * POST   /api/ai/providers          → add or update a provider entry
 * DELETE /api/ai/providers?id=...   → remove a provider
 */

import { NextResponse } from "next/server";
import { readEveSecrets, writeEveSecrets } from "@eve/dna";
import { requireAuth } from "@/lib/auth-server";

type ProviderId = "ollama" | "openrouter" | "anthropic" | "openai";
const VALID_PROVIDERS: ProviderId[] = ["ollama", "openrouter", "anthropic", "openai"];

const DEFAULT_MODELS: Record<ProviderId, string> = {
  anthropic: "claude-sonnet-4-7",
  openai: "gpt-5",
  openrouter: "anthropic/claude-sonnet-4-7",
  ollama: "llama3.1:8b",
};

export async function POST(req: Request) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const body = await req.json().catch(() => ({})) as {
    id?: string;
    apiKey?: string;
    baseUrl?: string;
    defaultModel?: string;
    enabled?: boolean;
  };

  if (!body.id || !VALID_PROVIDERS.includes(body.id as ProviderId)) {
    return NextResponse.json({ error: "Invalid provider id" }, { status: 400 });
  }
  const id = body.id as ProviderId;

  // Cloud providers require an API key (either in this body or already saved)
  const secrets = await readEveSecrets();
  const list = [...(secrets?.ai?.providers ?? [])];
  const idx = list.findIndex((p) => p.id === id);
  const existing = idx >= 0 ? list[idx] : undefined;

  const apiKey = body.apiKey ?? existing?.apiKey;
  const isCloud = id !== "ollama";
  if (isCloud && (!apiKey || apiKey.trim().length === 0)) {
    return NextResponse.json({ error: `${id} requires an API key` }, { status: 400 });
  }

  const next = {
    id,
    enabled: body.enabled ?? existing?.enabled ?? true,
    apiKey: apiKey ?? undefined,
    baseUrl: body.baseUrl ?? existing?.baseUrl,
    defaultModel: body.defaultModel ?? existing?.defaultModel ?? DEFAULT_MODELS[id],
  };

  if (idx >= 0) list[idx] = next;
  else list.push(next);

  await writeEveSecrets({ ai: { providers: list } });
  return NextResponse.json({ ok: true, provider: { ...next, apiKey: undefined } });
}

export async function DELETE(req: Request) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id || !VALID_PROVIDERS.includes(id as ProviderId)) {
    return NextResponse.json({ error: "Invalid provider id" }, { status: 400 });
  }

  const secrets = await readEveSecrets();
  const list = (secrets?.ai?.providers ?? []).filter(p => p.id !== id);

  // If we just removed the default, clear it
  const aiUpdate: Parameters<typeof writeEveSecrets>[0]["ai"] = { providers: list };
  if (secrets?.ai?.defaultProvider === id) aiUpdate.defaultProvider = undefined;
  if (secrets?.ai?.fallbackProvider === id) aiUpdate.fallbackProvider = undefined;

  await writeEveSecrets({ ai: aiUpdate });
  return NextResponse.json({ ok: true });
}
