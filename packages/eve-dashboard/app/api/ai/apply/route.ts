/**
 * Re-wire every installed component to use the current AI provider config.
 *
 * POST /api/ai/apply → calls wireAllInstalledComponents and returns per-component results.
 *
 * This is the dashboard's "Apply" button — equivalent to running `eve ai apply` on the host.
 * Note: this endpoint may take a few seconds because it restarts containers.
 */

import { NextResponse } from "next/server";
import { readEveSecrets, entityStateManager, wireAllInstalledComponents } from "@eve/dna";
import { requireAuth } from "@/lib/auth-server";

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

  const results = wireAllInstalledComponents(secrets, installed);
  const ok = results.filter(r => r.outcome === "ok").length;
  const failed = results.filter(r => r.outcome === "failed").length;

  return NextResponse.json({
    ok: failed === 0,
    summary: `${ok} ok, ${failed} failed, ${results.length - ok - failed} skipped`,
    results,
  });
}
