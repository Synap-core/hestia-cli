import { NextResponse } from "next/server";
import { entityStateManager } from "@eve/dna";
import { requireAuth } from "@/lib/auth-server";

export async function GET() {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  try {
    const state = await entityStateManager.getState();
    return NextResponse.json(state);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load state" },
      { status: 500 },
    );
  }
}
