/**
 * AI providers CRUD.
 *
 * POST   /api/ai/providers          → add or update a provider entry
 * DELETE /api/ai/providers?id=...   → remove a provider (built-in or custom)
 */

import { NextResponse } from "next/server";
import {
  readEveSecrets, writeEveSecrets, entityStateManager,
  wireAllInstalledComponents, AI_CONSUMERS, AI_CONSUMERS_NEEDING_RECREATE,
} from "@eve/dna";
import { runActionToCompletion } from "@eve/lifecycle";
import { requireAuth } from "@/lib/auth-server";

type ProviderId = "ollama" | "openrouter" | "anthropic" | "openai";
const VALID_PROVIDERS: ProviderId[] = ["ollama", "openrouter", "anthropic", "openai"];

/**
 * Apply AI config changes to running services.
 */
async function autoApply(opts: { recreate?: boolean } = {}) {
  try {
    const installed = await entityStateManager.getInstalledComponents();
    const consumers = installed.filter(id => AI_CONSUMERS.has(id));
    if (consumers.length === 0) return [];
    const fresh = await readEveSecrets();
    const wireResults = wireAllInstalledComponents(fresh, consumers);

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

    return wireResults;
  } catch {
    return [];
  }
}

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
    /** Whether this is a custom provider (vs built-in) */
    isCustom?: boolean;
    /** Display name for custom providers */
    name?: string;
  };

  // Custom provider path
  if (body.isCustom) {
    const secrets = await readEveSecrets();
    const list = [...(secrets?.ai?.customProviders ?? [])];

    if (body.id) {
      // Update existing custom provider
      const idx = list.findIndex(p => p.id === body.id);
      if (idx >= 0) {
        list[idx] = {
          ...list[idx],
          name: body.name ?? list[idx].name,
          baseUrl: body.baseUrl ?? list[idx].baseUrl,
          apiKey: body.apiKey ?? list[idx].apiKey,
          defaultModel: body.defaultModel ?? list[idx].defaultModel,
          enabled: body.enabled ?? list[idx].enabled ?? true,
        };
      }
    } else {
      // Create new custom provider
      const id = `custom-${Date.now()}`;
      list.push({
        id,
        name: body.name || id,
        baseUrl: body.baseUrl ?? '',
        apiKey: body.apiKey ?? '',
        defaultModel: body.defaultModel ?? '',
        enabled: body.enabled ?? true,
      });
    }

    await writeEveSecrets({ ai: { customProviders: list } });
    const applied = await autoApply({ recreate: true });
    return NextResponse.json({
      ok: true,
      provider: list.find(p => p.id === body.id) ?? list[list.length - 1],
      applied,
    });
  }

  // Built-in provider path
  if (!body.id || !VALID_PROVIDERS.includes(body.id as ProviderId)) {
    return NextResponse.json({ error: "Invalid provider id" }, { status: 400 });
  }
  const id = body.id as ProviderId;

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

  // Check built-in provider
  if (VALID_PROVIDERS.includes(id as ProviderId)) {
    const list = (secrets?.ai?.providers ?? []).filter(p => p.id !== id);

    const aiUpdate: Parameters<typeof writeEveSecrets>[0]["ai"] = { providers: list };
    if (secrets?.ai?.defaultProvider === id) aiUpdate.defaultProvider = undefined;
    if (secrets?.ai?.fallbackProvider === id) aiUpdate.fallbackProvider = undefined;

    const currentSvc = secrets?.ai?.serviceProviders ?? {};
    const cleanedSvc: Record<string, ProviderId> = {};
    for (const [svc, prov] of Object.entries(currentSvc)) {
      if (prov !== id) cleanedSvc[svc] = prov as ProviderId;
    }
    if (Object.keys(cleanedSvc).length !== Object.keys(currentSvc).length) {
      aiUpdate.serviceProviders = cleanedSvc;
    }

    await writeEveSecrets({ ai: aiUpdate });
    const applied = await autoApply({ recreate: true });
    return NextResponse.json({ ok: true, applied });
  }

  // Custom provider path
  const customList = (secrets?.ai?.customProviders ?? []).filter(p => p.id !== id);
  const hasCustomChanges = customList.length !== (secrets?.ai?.customProviders ?? []).length;

  if (hasCustomChanges) {
    await writeEveSecrets({ ai: { customProviders: customList } });
    const applied = await autoApply({ recreate: true });
    return NextResponse.json({ ok: true, applied });
  }

  return NextResponse.json({ error: "Provider not found" }, { status: 404 });
}
