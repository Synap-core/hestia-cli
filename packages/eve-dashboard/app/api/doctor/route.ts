import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-server";
import { runDoctor } from "@/lib/doctor";

export async function GET(req: Request) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  try {
    const checks = await runDoctor(req.url);
    const summary = {
      pass: checks.filter(c => c.status === "pass").length,
      warn: checks.filter(c => c.status === "warn").length,
      fail: checks.filter(c => c.status === "fail").length,
      total: checks.length,
    };
    return NextResponse.json({ checks, summary });
  } catch (err) {
    // Returning a typed error keeps the dashboard out of an infinite
    // "Running diagnostics…" spinner — the page reads { error } and
    // shows a Retry button. Logging here so the host operator can see
    // what went wrong (read-only in production via container logs).
    const message = err instanceof Error ? err.message : "doctor failed";
    console.error("[doctor] runDoctor threw:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
