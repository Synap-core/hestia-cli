/**
 * Doctor repair endpoint.
 *
 * The doctor report includes a `fix` hint per check. For checks where the
 * fix is mechanical, the dashboard can run it directly — that's this
 * endpoint. The repair `kind` enumerates the supported actions.
 */

import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { runActionToCompletion } from "@eve/lifecycle";
import { requireAuth } from "@/lib/auth-server";

const execFileAsync = promisify(execFile);

type RepairKind =
  | "create-eve-network"
  | "start-container"
  | "rewire-openclaw";

interface RepairBody {
  kind?: RepairKind;
  /** Component id, when relevant (e.g. start-container needs to know which one). */
  componentId?: string;
}

export async function POST(req: Request) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const body = (await req.json().catch(() => ({}))) as RepairBody;
  const kind = body.kind;

  switch (kind) {
    case "create-eve-network": {
      try {
        await execFileAsync("docker", ["network", "create", "eve-network"]);
        return NextResponse.json({ ok: true, summary: "eve-network created" });
      } catch (err) {
        return NextResponse.json(
          { ok: false, error: err instanceof Error ? err.message : String(err) },
          { status: 500 },
        );
      }
    }

    case "start-container": {
      if (!body.componentId) {
        return NextResponse.json({ error: "componentId required" }, { status: 400 });
      }
      const result = await runActionToCompletion(body.componentId, "start");
      return NextResponse.json(result, { status: result.ok ? 200 : 500 });
    }

    case "rewire-openclaw": {
      // Re-applies AI provider wiring directly — same code path as
      // /api/ai/apply but scoped logic. Re-runs wire-ai for openclaw.
      try {
        const { readEveSecrets, wireAllInstalledComponents } = await import("@eve/dna");
        const secrets = await readEveSecrets();
        const results = wireAllInstalledComponents(secrets, ["openclaw"]);
        const failed = results.filter(r => r.outcome === "failed");
        if (failed.length > 0) {
          return NextResponse.json(
            { ok: false, error: failed.map(f => f.summary).join("; "), results },
            { status: 500 },
          );
        }
        return NextResponse.json({ ok: true, summary: "OpenClaw re-wired", results });
      } catch (err) {
        return NextResponse.json(
          { ok: false, error: err instanceof Error ? err.message : String(err) },
          { status: 500 },
        );
      }
    }

    default:
      return NextResponse.json(
        { error: `Unknown repair: ${kind ?? "(none)"}` },
        { status: 400 },
      );
  }
}
