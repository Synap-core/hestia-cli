/**
 * AI providers CRUD.
 *
 * POST   /api/ai/providers          → add or update a provider entry
 * DELETE /api/ai/providers?id=...   → remove a provider (built-in or custom)
 */

import { NextResponse } from "next/server";
import {
  readEveSecrets, writeEveSecrets, entityStateManager,
  AI_CONSUMERS, AI_CONSUMERS_NEEDING_RECREATE,
} from "@eve/dna";
import { materializeTargets, runActionToCompletion } from "@eve/lifecycle";
import { requireAuth } from "@/lib/auth-server";

type ProviderId = "ollama" | "openrouter" | "anthropic" | "openai";
const VALID_PROVIDERS: ProviderId[] = ["ollama", "openrouter", "anthropic", "openai"];

const NAME_MAP: Record<ProviderId, string> = {
  ollama: "Ollama (local)",
  openrouter: "OpenRouter",
  anthropic: "Anthropic",
  openai: "OpenAI",
};

const DEFAULT_MODELS: Record<ProviderId, string> = {
  anthropic: "claude-sonnet-4-7",
  openai: "gpt-5",
  openrouter: "anthropic/claude-sonnet-4-7",
  ollama: "llama3.1:8b",
};

const DEFAULT_BASE_URLS: Partial<Record<ProviderId, string>> = {
  ollama: "http://localhost:11434",
};

/**
 * Apply AI config changes to running services.
 */
async function autoApply(opts: { recreate?: boolean } = {}) {
  try {
    const installed = await entityStateManager.getInstalledComponents();
    const consumers = installed.filter(id => AI_CONSUMERS.has(id));
    if (consumers.length === 0) return [];
    const fresh = await readEveSecrets();
    const [materialized] = await materializeTargets(fresh, ["ai-wiring"], { components: consumers });
    const wireResults = Array.isArray(materialized?.details?.results)
      ? materialized.details.results as Array<{ id: string; outcome: "ok" | "failed" | "skipped"; summary: string }>
      : [];

    if (opts.recreate) {
      for (const id of AI_CONSUMERS_NEEDING_RECREATE) {
        if (!consumers.includes(id)) continue;
        const r = await runActionToCompletion(id, "recreate");
        const recreated = {
          id,
          outcome: r.ok ? "ok" as const : "failed" as const,
          summary: r.ok
            ? `${id} recreated · new env applied`
            : `${id} recreate failed: ${r.error ?? "unknown"}`,
        };
        const idx = wireResults.findIndex(x => x.id === id);
        if (idx >= 0) wireResults[idx] = recreated;
        else wireResults.push(recreated);
      }
    }

    // Persist wiringStatus so the UI can show "Last applied" in the
    // per-service routing panel.
    if (wireResults.length > 0) {
      const wiringStatus: Record<string, { lastApplied: string; outcome: string }> =
        wireResults.reduce((acc, r) => {
          acc[r.id] = { lastApplied: new Date().toISOString(), outcome: r.outcome };
          return acc;
        }, {} as Record<string, { lastApplied: string; outcome: string }>);
      await writeEveSecrets({ ai: { wiringStatus } });
    }

    return wireResults;
  } catch {
    return [];
  }
}

/**
 * Resolve a provider id: strip `custom-` prefix for display, and check
 * whether the id refers to a built-in provider.
 */
function isBuiltIn(id: string): id is ProviderId {
  return VALID_PROVIDERS.includes(id as ProviderId);
}

/**
 * Ensure a provider entry has a name — derive from id for built-ins,
 * use the provided name or the id itself for custom providers.
 */
function withName(id: string, name: string | undefined): string {
  return name || NAME_MAP[id as ProviderId] || id;
}

export async function POST(req: Request) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const body = await req.json().catch(() => ({})) as {
    id?: string;
    apiKey?: string;
    baseUrl?: string;
    defaultModel?: string;
    enabled?: boolean;
    /** Whether this is a custom provider (vs built-in) */
    isCustom?: boolean;
    /** Display name for custom providers */
    name?: string;
  };

  const secrets = await readEveSecrets();
  const list = [...(secrets?.ai?.providers ?? [])];

  // Determine the canonical id and whether this is a custom entry.
  let resolvedId: string;
  let isCustom: boolean;

  if (body.isCustom || body.id?.startsWith('custom-')) {
    isCustom = true;
    resolvedId = body.id ?? `custom-${Date.now()}`;
  } else if (body.id && VALID_PROVIDERS.includes(body.id as ProviderId)) {
    isCustom = false;
    resolvedId = body.id as ProviderId;
  } else {
    return NextResponse.json({ error: "Invalid provider id" }, { status: 400 });
  }

  const idx = list.findIndex((p) => p.id === resolvedId);
  const existing = idx >= 0 ? list[idx] : undefined;

  // Built-in cloud providers require an API key (Ollama is local — no key needed).
  if (!isCustom && isBuiltIn(resolvedId)) {
    const apiKey = body.apiKey ?? existing?.apiKey;
    if (resolvedId !== "ollama" && (!apiKey || apiKey.trim().length === 0)) {
      return NextResponse.json({ error: `${resolvedId} requires an API key` }, { status: 400 });
    }

    const next = {
      id: resolvedId,
      name: withName(resolvedId, body.name),
      enabled: body.enabled ?? existing?.enabled ?? true,
      apiKey: apiKey ?? undefined,
      baseUrl: body.baseUrl ?? existing?.baseUrl ?? DEFAULT_BASE_URLS[resolvedId],
      defaultModel: body.defaultModel ?? existing?.defaultModel ?? DEFAULT_MODELS[resolvedId],
    };

    if (idx >= 0) list[idx] = next;
    else list.push(next);

    await writeEveSecrets({ ai: { providers: list } });
    const applied = await autoApply({ recreate: true });
    return NextResponse.json({
      ok: true,
      provider: { ...next, apiKey: undefined },
      applied,
    });
  }

  // Custom provider path.
  const apiKey = body.apiKey ?? existing?.apiKey;
  const next = {
    id: resolvedId,
    name: withName(resolvedId, body.name ?? existing?.name),
    enabled: body.enabled ?? existing?.enabled ?? true,
    apiKey: apiKey ?? undefined,
    baseUrl: body.baseUrl ?? existing?.baseUrl ?? '',
    defaultModel: body.defaultModel ?? existing?.defaultModel ?? '',
  };

  if (idx >= 0) list[idx] = next;
  else list.push(next);

  await writeEveSecrets({ ai: { providers: list } });
  const applied = await autoApply({ recreate: true });
  return NextResponse.json({
    ok: true,
    provider: { ...next, apiKey: undefined },
    applied,
  });
}

export async function DELETE(req: Request) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing provider id" }, { status: 400 });
  }

  const secrets = await readEveSecrets();
  const existingList = secrets?.ai?.providers ?? [];

  const targetIdx = existingList.findIndex(p => p.id === id);
  if (targetIdx < 0) {
    return NextResponse.json({ error: "Provider not found" }, { status: 404 });
  }

  const list = existingList.filter(p => p.id !== id);

  const aiUpdate: Parameters<typeof writeEveSecrets>[0]["ai"] = { providers: list };
  if (secrets?.ai?.defaultProvider === id) aiUpdate.defaultProvider = undefined;
  if (secrets?.ai?.fallbackProvider === id) aiUpdate.fallbackProvider = undefined;

  const currentSvc = secrets?.ai?.serviceProviders ?? {};
  const cleanedSvc: Record<string, string> = {};
  for (const [svc, prov] of Object.entries(currentSvc)) {
    if (prov !== id) cleanedSvc[svc] = prov;
  }
  if (Object.keys(cleanedSvc).length !== Object.keys(currentSvc).length) {
    aiUpdate.serviceProviders = cleanedSvc;
  }

  await writeEveSecrets({ ai: aiUpdate });
  const applied = await autoApply({ recreate: true });
  return NextResponse.json({ ok: true, applied });
}
