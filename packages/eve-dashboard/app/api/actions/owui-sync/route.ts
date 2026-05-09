/**
 * POST /api/actions/owui-sync
 *
 * Force re-sync a specific OpenWebUI surface from the dashboard without
 * requiring CLI access. Accepts a `surface` body param:
 *
 *   "model-sources"  — re-wire AI providers into OpenWebUI (same as `eve ai apply`)
 *   "skills"         — re-push Synap SKILL.md packages as OWUI Prompts
 *   "knowledge"      — re-sync Synap knowledge entries to the OWUI collection
 *   "tools"          — re-register Synap Hub Protocol as an OWUI tool server
 *   "extras"         — run all three extras syncs in parallel (skills + knowledge + tools)
 */

import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-server";
import { readEveSecrets, syncOpenwebuiExtras } from "@eve/dna";
import { materializeTargets } from "@eve/lifecycle";

type Surface = "model-sources" | "skills" | "knowledge" | "tools" | "extras";

interface SyncRequest {
  surface: Surface;
}

export async function POST(req: Request) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const body = (await req.json().catch(() => ({}))) as Partial<SyncRequest>;
  const surface = body.surface;

  if (!surface) {
    return NextResponse.json({ error: "surface required" }, { status: 400 });
  }

  const secrets = await readEveSecrets();

  if (surface === "model-sources") {
    const [result] = await materializeTargets(secrets, ["ai-wiring"]);
    return NextResponse.json({
      ok: result?.ok ?? false,
      summary: result?.summary ?? "AI wiring complete",
    }, { status: result?.ok ? 200 : 500 });
  }

  // Extras syncs — map surface to which syncOpenwebuiExtras sub-calls to run.
  // We pass an options object that skips the surfaces we don't need by
  // replacing the relevant async call with a resolved no-op.
  const cwd = "/opt/openwebui";

  if (surface === "extras") {
    const result = await syncOpenwebuiExtras(cwd, secrets);
    if (result.skipped) {
      return NextResponse.json({
        ok: false,
        summary: "Skipped — no Hub URL configured. Set the Synap pod URL first.",
      }, { status: 400 });
    }
    const skillsOk = result.skills?.ok ?? false;
    const knowledgeOk = result.knowledge?.ok ?? false;
    const toolsOk = result.tools?.ok ?? false;
    const allOk = skillsOk && knowledgeOk && toolsOk;
    return NextResponse.json({
      ok: allOk,
      summary: [
        `skills: ${skillsOk ? "ok" : "failed"}`,
        `knowledge: ${knowledgeOk ? "ok" : "failed"}`,
        `tools: ${toolsOk ? "ok" : "failed"}`,
      ].join(", "),
      details: {
        skills: result.skills,
        knowledge: result.knowledge,
        tools: result.tools,
      },
    }, { status: allOk ? 200 : 500 });
  }

  // Single-surface syncs — run syncOpenwebuiExtras but only report the
  // relevant surface. The underlying helpers run in parallel inside
  // syncOpenwebuiExtras; individual failures are isolated.
  const result = await syncOpenwebuiExtras(cwd, secrets);

  if (result.skipped) {
    return NextResponse.json({
      ok: false,
      summary: "Skipped — no Hub URL configured. Set the Synap pod URL first.",
    }, { status: 400 });
  }

  const surfaceResult =
    surface === "skills" ? result.skills :
    surface === "knowledge" ? result.knowledge :
    surface === "tools" ? result.tools :
    undefined;

  if (!surfaceResult) {
    return NextResponse.json({ error: `Unknown surface: ${surface}` }, { status: 400 });
  }

  return NextResponse.json({
    ok: surfaceResult.ok,
    summary: surfaceResult.ok
      ? `${surface} sync complete`
      : `${surface} sync failed: ${(surfaceResult as { ok: false; error: string }).error}`,
  }, { status: surfaceResult.ok ? 200 : 500 });
}
