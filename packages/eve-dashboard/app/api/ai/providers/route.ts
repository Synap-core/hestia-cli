/**
 * AI providers CRUD.
 *
 * POST   /api/ai/providers  → add or update a provider (upsert)
 * DELETE /api/ai/providers  → remove a provider
 *
 * Source of truth: pod `ai_providers` table via tRPC `aiProviders.*`.
 * A local mirror is kept in `secrets.ai.providers` for backwards
 * compatibility with the local AI-wiring / autoApply pipeline
 * (materializeTargets reads from secrets to set env vars on containers).
 *
 * If the pod is unreachable the route falls back to local-only mode
 * (same behaviour as before the migration) and logs a warning.
 */

import { NextResponse } from "next/server";
import {
  readEveSecrets, writeEveSecrets, entityStateManager,
  AI_CONSUMERS, AI_CONSUMERS_NEEDING_RECREATE,
  resolveSynapUrl, readAgentKeyOrLegacy,
} from "@eve/dna";
import { materializeTargets, runActionToCompletion } from "@eve/lifecycle";
import { requireAuth } from "@/lib/auth-server";

// ── tRPC batch-HTTP helpers (server-side, uses hub API key) ───────────────────

interface TrpcBatchResult<T> {
  result: { data: { json: T } };
}

async function podMutation<T>(
  podUrl: string,
  apiKey: string,
  path: string,
  input?: unknown,
): Promise<T> {
  const res = await fetch(`${podUrl.replace(/\/$/, "")}/trpc/${path}?batch=1`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ "0": { json: input ?? null } }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Pod tRPC ${path} → ${res.status}: ${text}`);
  }
  const data: TrpcBatchResult<T>[] = await res.json();
  return data[0].result.data.json;
}

async function resolvePodAuth(): Promise<{ podUrl: string; apiKey: string } | null> {
  try {
    const secrets = await readEveSecrets();
    const podUrl = resolveSynapUrl(secrets);
    if (!podUrl) return null;
    const apiKey = await readAgentKeyOrLegacy("eve", process.env.EVE_HOME ?? process.cwd());
    if (!apiKey) return null;
    return { podUrl, apiKey };
  } catch {
    return null;
  }
}

// ── Local AI wiring (unchanged — operates on secrets.json) ───────────────────

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

// ── POST — add or update provider ────────────────────────────────────────────

export async function POST(req: Request) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const body = await req.json().catch(() => ({})) as {
    id?: string;
    apiKey?: string;
    baseUrl?: string;
    defaultModel?: string;
    enabled?: boolean;
    isCustom?: boolean;
    name?: string;
    /** Models array (for richer pod sync) */
    models?: Array<{ id: string; tier?: string }>;
    priority?: number;
  };

  if (!body.id) {
    return NextResponse.json({ error: "Missing provider id" }, { status: 400 });
  }

  const providerId = body.id;
  const name = body.name ?? providerId;

  // Infer a sensible env-var name from the provider id.
  const apiKeyEnvVar = `${providerId.toUpperCase().replace(/-/g, "_")}_API_KEY`;

  // ── 1. Push to pod DB (source of truth) ──────────────────────────────
  const podAuth = await resolvePodAuth();
  let podSynced = false;

  if (podAuth) {
    try {
      await podMutation(podAuth.podUrl, podAuth.apiKey, "aiProviders.upsert", {
        providerId,
        name,
        baseUrl: body.baseUrl ?? "",
        apiKeyEnvVar,
        ...(body.apiKey ? { apiKey: body.apiKey } : {}),
        enabled: body.enabled ?? true,
        priority: body.priority ?? 10,
        models: body.models ?? (body.defaultModel ? [{ id: body.defaultModel }] : []),
      });
      podSynced = true;
    } catch (err) {
      console.warn("[ai/providers] Pod upsert failed (falling back to local only):", err);
    }
  }

  // ── 2. Mirror to secrets.json (for local service wiring) ─────────────
  const secrets = await readEveSecrets();
  const list = [...(secrets?.ai?.providers ?? [])];
  const idx = list.findIndex(p => p.id === providerId);
  const existing = idx >= 0 ? list[idx] : undefined;

  const localEntry = {
    id: providerId,
    name,
    enabled: body.enabled ?? existing?.enabled ?? true,
    apiKey: body.apiKey ?? existing?.apiKey ?? undefined,
    baseUrl: body.baseUrl ?? existing?.baseUrl ?? "",
    defaultModel: body.defaultModel ?? existing?.defaultModel ?? "",
  };

  if (idx >= 0) list[idx] = localEntry;
  else list.push(localEntry);

  await writeEveSecrets({ ai: { providers: list } });

  // ── 3. Re-wire local services ─────────────────────────────────────────
  const applied = await autoApply({ recreate: true });

  return NextResponse.json({
    ok: true,
    podSynced,
    provider: { ...localEntry, apiKey: undefined },
    applied,
  });
}

// ── DELETE — remove provider ──────────────────────────────────────────────────

export async function DELETE(req: Request) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const { searchParams } = new URL(req.url);
  const providerId = searchParams.get("id");
  if (!providerId) {
    return NextResponse.json({ error: "Missing provider id" }, { status: 400 });
  }

  // ── 1. Remove from pod DB ─────────────────────────────────────────────
  const podAuth = await resolvePodAuth();
  let podSynced = false;

  if (podAuth) {
    try {
      await podMutation(podAuth.podUrl, podAuth.apiKey, "aiProviders.remove", { providerId });
      podSynced = true;
    } catch (err) {
      console.warn("[ai/providers] Pod remove failed (falling back to local only):", err);
    }
  }

  // ── 2. Remove from secrets.json mirror ───────────────────────────────
  const secrets = await readEveSecrets();
  const existingList = secrets?.ai?.providers ?? [];

  const list = existingList.filter(p => p.id !== providerId);

  const aiUpdate: Parameters<typeof writeEveSecrets>[0]["ai"] = { providers: list };
  if (secrets?.ai?.defaultProvider === providerId) aiUpdate.defaultProvider = undefined;
  if (secrets?.ai?.fallbackProvider === providerId) aiUpdate.fallbackProvider = undefined;

  const currentSvc = secrets?.ai?.serviceProviders ?? {};
  const cleanedSvc: Record<string, string> = {};
  for (const [svc, prov] of Object.entries(currentSvc)) {
    if (prov !== providerId) cleanedSvc[svc] = prov;
  }
  if (Object.keys(cleanedSvc).length !== Object.keys(currentSvc).length) {
    aiUpdate.serviceProviders = cleanedSvc;
  }

  await writeEveSecrets({ ai: aiUpdate });

  // ── 3. Re-wire local services ─────────────────────────────────────────
  const applied = await autoApply({ recreate: true });

  return NextResponse.json({ ok: true, podSynced, applied });
}
