/**
 * Doctor repair endpoint.
 *
 * The doctor report includes a `fix` hint per check. For checks where the
 * fix is mechanical, the dashboard can run it directly — that's this
 * endpoint. The repair `kind` enumerates the supported actions.
 */

import { NextResponse } from "next/server";
import type { RepairRequest } from "@eve/dna";
import { runRepair } from "@eve/lifecycle";
import { requireAuth } from "@/lib/auth-server";

export async function POST(req: Request) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const body = (await req.json().catch(() => ({}))) as Partial<RepairRequest>;
  const kind = body.kind;

  if (!kind) {
    return NextResponse.json({ error: "kind required" }, { status: 400 });
  }

  const result = await runRepair({
    kind,
    componentId: body.componentId,
    target: body.target,
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
