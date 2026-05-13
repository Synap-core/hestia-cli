/**
 * GET /api/ai/is-models
 *
 * Fetches the live model list from Synap IS (/v1/models).
 * IS is the AI gateway — the models it returns are the ones every other
 * component (Hermes, OpenClaw, OpenWebUI) can actually request.
 */

import { NextResponse } from "next/server";
import { resolvePodUrl, readAgentKeyOrLegacy } from "@eve/dna";
import { requireAuth } from "@/lib/auth-server";

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
    const res = await fetch(`${base}/v1/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(8_000),
    });
    const latency = Date.now() - start;

    if (!res.ok) {
      return NextResponse.json({
        ok: false, latency, error: `IS returned HTTP ${res.status}`,
      });
    }

    const data = await res.json() as { data?: Array<{ id: string }> };
    const models = (data.data ?? []).map(m => m.id);
    return NextResponse.json({ ok: true, latency, models });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      latency: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
