import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-server";
import { runDoctor } from "@/lib/doctor";

export async function GET() {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const checks = await runDoctor();
  const summary = {
    pass: checks.filter(c => c.status === "pass").length,
    warn: checks.filter(c => c.status === "warn").length,
    fail: checks.filter(c => c.status === "fail").length,
    total: checks.length,
  };
  return NextResponse.json({ checks, summary });
}
