/**
 * AI providers CRUD.
 *
 * POST   /api/ai/providers          → add or update a provider entry
 * DELETE /api/ai/providers?id=...   → remove a provider
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
 *
 * - Wire path: per-component file/exec writes + dockerRestart.
 *   Sufficient when the affected config lives in compose `.env` or
 *   in a mounted volume the container reads on boot.
 * - Recreate path: for components in `AI_CONSUMERS_NEEDING_RECREATE`
 *   (currently `openclaw`) whose env is fixed at `docker run` time —
 *   restart-only would leave stale env. The lifecycle `recreate`
 *   action does `docker rm -f` + re-run with current secrets.
 *
 * Pass `recreate: true` to engage the recreate path. Defaulting to
 * false keeps key-only edits cheap.
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
  // Auto-apply so a freshly added/edited key lands on running services.
  // Recreate openclaw because changing a provider's `defaultModel` would
  // otherwise leave OpenClaw's `DEFAULT_MODEL` env stale.
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
  if (!id || !VALID_PROVIDERS.includes(id as ProviderId)) {
    return NextResponse.json({ error: "Invalid provider id" }, { status: 400 });
  }

  const secrets = await readEveSecrets();
  const list = (secrets?.ai?.providers ?? []).filter(p => p.id !== id);

  // Clean up every reference to the removed provider — leaving dangling
  // ids in defaultProvider/fallbackProvider/serviceProviders would cause
  // pickPrimaryProvider to silently fall through to "first usable" while
  // the dashboard UI keeps showing the deleted name.
  const aiUpdate: Parameters<typeof writeEveSecrets>[0]["ai"] = { providers: list };
  if (secrets?.ai?.defaultProvider === id) aiUpdate.defaultProvider = undefined;
  if (secrets?.ai?.fallbackProvider === id) aiUpdate.fallbackProvider = undefined;

  // serviceProviders entries pointing at the deleted provider must be
  // dropped too. Rebuild the map without them.
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
