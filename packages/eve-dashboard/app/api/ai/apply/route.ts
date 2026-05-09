/**
 * Re-wire every installed component to use the current AI provider config.
 *
 * POST /api/ai/apply → calls wireAllInstalledComponents and returns per-component results.
 *
 * This is the dashboard's "Apply" button — equivalent to running `eve ai apply` on the host.
 * Note: this endpoint may take a few seconds because it restarts containers.
 */

import { NextResponse } from "next/server";
import {
  readEveSecrets, entityStateManager,
  AI_CONSUMERS_NEEDING_RECREATE,
} from "@eve/dna";
import { materializeTargets, runActionToCompletion } from "@eve/lifecycle";
import { requireAuth } from "@/lib/auth-server";

type WireResult = { id: string; outcome: "ok" | "failed" | "skipped"; summary: string };

export async function POST() {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const secrets = await readEveSecrets();
  let installed: string[] = [];
  try {
    installed = await entityStateManager.getInstalledComponents();
  } catch { /* state not initialized */ }

  if (installed.length === 0) {
    return NextResponse.json({ ok: true, results: [], message: "No installed components" });
  }

  const [materialized] = await materializeTargets(secrets, ["ai-wiring"], { components: installed });
  const results = Array.isArray(materialized?.details?.results)
    ? materialized.details.results as WireResult[]
    : [];

  // Wire-only restart isn't enough for components whose env is set at
  // `docker run` time (openclaw). Replace their wire result with a
  // recreate via lifecycle so the manual "Apply" button is actually
  // sufficient — same guarantee as auto-apply.
  for (const id of AI_CONSUMERS_NEEDING_RECREATE) {
    if (!installed.includes(id)) continue;
    const r = await runActionToCompletion(id, "recreate");
    const recreated = {
      id,
      outcome: r.ok ? "ok" as const : "failed" as const,
      summary: r.ok
        ? `${id} recreated · new env applied`
        : `${id} recreate failed: ${r.error ?? "unknown"}`,
    };
    const idx = results.findIndex(x => x.id === id);
    if (idx >= 0) results[idx] = recreated;
    else results.push(recreated);
  }

  const ok = results.filter(r => r.outcome === "ok").length;
  const failed = results.filter(r => r.outcome === "failed").length;

  return NextResponse.json({
    ok: Boolean(materialized?.ok) && failed === 0,
    summary: `${ok} ok, ${failed} failed, ${results.length - ok - failed} skipped`,
    materialized,
    results,
  });
}
