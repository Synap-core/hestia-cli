/**
 * AI provider config endpoint.
 *
 * GET   /api/ai          → returns providers, defaultProvider, fallbackProvider
 * PATCH /api/ai          → updates defaultProvider/fallbackProvider/mode
 */

import { NextResponse } from "next/server";
import {
  readEveSecrets, writeEveSecrets, entityStateManager,
  AI_CONSUMERS, AI_CONSUMERS_NEEDING_RECREATE,
  type WireAiResult,
} from "@eve/dna";
import { materializeTargets, runActionToCompletion } from "@eve/lifecycle";
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
    isCustom: p.id.startsWith('custom-'),
    name: p.name,
  }));

  return NextResponse.json({
    mode: ai.mode ?? null,
    defaultProvider: ai.defaultProvider ?? null,
    fallbackProvider: ai.fallbackProvider ?? null,
    serviceProviders: ai.serviceProviders ?? {},
    serviceModels: ai.serviceModels ?? {},
    wiringStatus: ai.wiringStatus ?? {},
    providers,
    validProviders: VALID_PROVIDERS,
    // Single source of truth: the client uses this list to filter
    // components for the per-service routing panel. Avoids drift
    // between the hardcoded list on the page and `@eve/dna`.
    aiConsumers: Array.from(AI_CONSUMERS),
    aiConsumersNeedingRecreate: Array.from(AI_CONSUMERS_NEEDING_RECREATE),
  });
}

export async function PATCH(req: Request) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const body = await req.json().catch(() => ({})) as {
    defaultProvider?: ProviderId;
    fallbackProvider?: ProviderId | null;
    mode?: "local" | "provider" | "hybrid";
    /**
     * Per-service override map. `{ openclaw: "anthropic" }` makes OpenClaw
     * default to Anthropic regardless of the global `defaultProvider`.
     * Pass `null` for a key to clear that service's override.
     */
    serviceProviders?: Record<string, ProviderId | null>;
    /**
     * Per-service model override. `{ openclaw: "claude-sonnet-4-7" }` makes
     * OpenClaw use that specific model regardless of the provider's defaultModel.
     * Pass `null` for a key to clear that service's model override.
     */
    serviceModels?: Record<string, string | null>;
  };

  // Read current secrets for provider validation and later merging.
  const secrets = await readEveSecrets();

  // Validate providers against both built-in enum and the actual configured list.
  if (body.defaultProvider) {
    const allIds = (secrets?.ai?.providers ?? []).map(p => p.id);
    if (!VALID_PROVIDERS.includes(body.defaultProvider) && !allIds.includes(body.defaultProvider)) {
      return NextResponse.json({ error: "Invalid defaultProvider" }, { status: 400 });
    }
  }
  if (body.fallbackProvider) {
    const allIds = (secrets?.ai?.providers ?? []).map(p => p.id);
    if (!VALID_PROVIDERS.includes(body.fallbackProvider) && !allIds.includes(body.fallbackProvider)) {
      return NextResponse.json({ error: "Invalid fallbackProvider" }, { status: 400 });
    }
  }
  if (body.serviceProviders) {
    const allIds = (secrets?.ai?.providers ?? []).map(p => p.id);
    for (const [svc, prov] of Object.entries(body.serviceProviders)) {
      if (prov !== null && !VALID_PROVIDERS.includes(prov) && !allIds.includes(prov)) {
        return NextResponse.json(
          { error: `Invalid provider "${prov}" for service "${svc}"` },
          { status: 400 },
        );
      }
    }
  }

  const next: Record<string, unknown> = {};
  if (body.defaultProvider !== undefined) next.defaultProvider = body.defaultProvider;
  if (body.fallbackProvider !== undefined) next.fallbackProvider = body.fallbackProvider ?? undefined;
  if (body.mode !== undefined) next.mode = body.mode;

  // Merge serviceProviders: keep existing entries, drop the ones explicitly
  // set to `null`. This way the UI can clear one service without resending
  // the whole map.
  if (body.serviceProviders) {
    const current = secrets?.ai?.serviceProviders ?? {};
    const merged: Record<string, string> = { ...current };
    for (const [svc, prov] of Object.entries(body.serviceProviders)) {
      if (prov === null) delete merged[svc];
      else merged[svc] = prov;
    }
    next.serviceProviders = merged;
  }

  // Merge serviceModels: same null-to-clear pattern.
  if (body.serviceModels) {
    const current = secrets?.ai?.serviceModels ?? {};
    const merged: Record<string, string> = { ...current };
    for (const [svc, model] of Object.entries(body.serviceModels)) {
      if (model === null) delete merged[svc];
      else merged[svc] = model;
    }
    next.serviceModels = merged;
  }

  await writeEveSecrets({ ai: next as Parameters<typeof writeEveSecrets>[0]["ai"] });

  // Auto-apply: changing `defaultProvider` or any `serviceProviders` entry
  // should propagate to running components without a second click. The
  // explicit "Apply" button stays available for manual re-runs.
  //
  // For each component listed in AI_CONSUMERS_NEEDING_RECREATE whose
  // resolved provider/model could have changed, we trigger a lifecycle
  // `recreate` (rather than the wire-only restart) so docker-run-time env
  // is refreshed. We over-include rather than try to compute exact
  // diffs — recreate is idempotent and infrequent.
  let applyResults: WireAiResult[] = [];
  const shouldApply =
    body.defaultProvider !== undefined ||
    body.serviceProviders !== undefined ||
    body.serviceModels !== undefined ||
    body.mode !== undefined;

  if (shouldApply) {
    try {
      const installed = await entityStateManager.getInstalledComponents();
      const consumers = installed.filter(id => AI_CONSUMERS.has(id));
      if (consumers.length > 0) {
        const fresh = await readEveSecrets(); // re-read after write
        const [materialized] = await materializeTargets(fresh, ["ai-wiring"], { components: consumers });
        applyResults = Array.isArray(materialized?.details?.results)
          ? materialized.details.results as WireAiResult[]
          : [];

        for (const id of AI_CONSUMERS_NEEDING_RECREATE) {
          if (!consumers.includes(id)) continue;
          // Skip recreate if this PATCH didn't touch this component's
          // routing (e.g. PATCH only changed serviceProviders.openwebui
          // — no need to recreate openclaw).
          const touchesThis =
            body.serviceProviders?.[id] !== undefined ||
            body.serviceModels?.[id] !== undefined ||
            (body.defaultProvider !== undefined && !body.serviceProviders?.[id]);
          if (!touchesThis) continue;

          const r = await runActionToCompletion(id, "recreate");
          const recreated = {
            id,
            outcome: r.ok ? "ok" as const : "failed" as const,
            summary: r.ok
              ? `${id} recreated · new env applied`
              : `${id} recreate failed: ${r.error ?? "unknown"}`,
          };
          const idx = applyResults.findIndex(x => x.id === id);
          if (idx >= 0) applyResults[idx] = recreated;
          else applyResults.push(recreated);
        }
      }
    } catch {
      // state.json missing or wire-ai threw — return ok=true with empty
      // results, the user can still hit Apply manually.
    }
  }

  // Persist wiringStatus so the UI can show "Last applied" in the
  // per-service routing panel. Only overwrite the keys we have
  // results for — leave the rest untouched.
  if (applyResults.length > 0) {
    const patch: Parameters<typeof writeEveSecrets>[0]["ai"] = {
      wiringStatus: applyResults.reduce<Record<string, { lastApplied: string; outcome: string }>>(
        (acc, r) => {
          acc[r.id] = { lastApplied: new Date().toISOString(), outcome: r.outcome };
          return acc;
        },
        {},
      ),
    };
    try { await writeEveSecrets({ ai: patch }); } catch { /* non-fatal */ }
  }

  return NextResponse.json({ ok: true, applied: applyResults });
}
