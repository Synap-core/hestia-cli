/**
 * GET /api/ai/is-models
 *
 * Fetches the live model list and active config from Synap IS.
 * IS is the AI gateway — the models it returns are the ones every other
 * component (Hermes, OpenClaw, OpenWebUI) can actually request.
 *
 * Response:
 *   ok       — whether IS responded successfully
 *   latency  — round-trip ms
 *   models   — list of model ids from /v1/models
 *   config   — active AI config from /v1/config (provider, model, key presence)
 */

import { NextResponse } from "next/server";
import { resolvePodUrl, readAgentKeyOrLegacy } from "@eve/dna";
import { requireAuth } from "@/lib/auth-server";

interface IsConfig {
  provider: string | null;
  model: string | null;
  ollamaEnabled: boolean;
  customProviders: Array<{ name: string; baseUrl: string; defaultModel: string | null }>;
  hasOpenai: boolean;
  hasAnthropic: boolean;
  hasOpenrouter: boolean;
}

export async function GET(req: Request) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const podUrl = await resolvePodUrl(undefined, req.url, new Headers());
  if (!podUrl) {
    return NextResponse.json({ error: "Could not resolve Synap IS URL" }, { status: 503 });
  }

  const apiKey = await readAgentKeyOrLegacy('eve');
  if (!apiKey) {
    return NextResponse.json({ error: "No Eve agent key — run provisioning first" }, { status: 503 });
  }

  const base = podUrl.replace(/\/+$/, "");
  const start = Date.now();
  try {
    const [modelsRes, configRes] = await Promise.all([
      fetch(`${base}/v1/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(8_000),
      }),
      fetch(`${base}/v1/config`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(8_000),
      }),
    ]);
    const latency = Date.now() - start;

    if (!modelsRes.ok) {
      return NextResponse.json({
        ok: false, latency, error: `IS returned HTTP ${modelsRes.status}`,
      });
    }

    const modelsData = await modelsRes.json() as { data?: Array<{ id: string }> };
    const models = (modelsData.data ?? []).map(m => m.id);

    let config: IsConfig | null = null;
    if (configRes.ok) {
      config = await configRes.json() as IsConfig;
    }

    return NextResponse.json({ ok: true, latency, models, config });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      latency: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
