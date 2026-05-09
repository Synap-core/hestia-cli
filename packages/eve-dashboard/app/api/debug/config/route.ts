import { NextResponse } from "next/server";
import { buildConfigDebugPayload } from "@eve/dna";
import { requireAuth } from "@/lib/auth-server";

export async function GET() {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  return NextResponse.json(await buildConfigDebugPayload());
}
