import { NextResponse } from "next/server";
import { buildEventsDebugPayload } from "@eve/dna";
import { requireAuth } from "@/lib/auth-server";

export async function GET(req: Request) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const url = new URL(req.url);
  const rawLimit = url.searchParams.get("limit");
  const limit = rawLimit ? Number.parseInt(rawLimit, 10) : 100;

  return NextResponse.json(await buildEventsDebugPayload(Number.isFinite(limit) ? limit : 100));
}
