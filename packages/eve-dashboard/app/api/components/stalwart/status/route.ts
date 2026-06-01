/**
 * Stalwart status — mail domain + liveness for the config panel header badge.
 */
import { NextResponse } from "next/server";
import { readEveSecrets } from "@eve/dna";
import { StalwartAdmin } from "@eve/mouth";
import { requireAuth } from "@/lib/auth-server";

export async function GET() {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const secrets = await readEveSecrets().catch(() => null);
  const stalwart = secrets?.stalwart;
  const adminPassword = stalwart?.adminPassword;
  const domain = stalwart?.domain ?? null;

  if (!adminPassword) {
    return NextResponse.json({ domain, live: false });
  }

  const admin = new StalwartAdmin({ adminPassword });
  const live = await admin.isLive().catch(() => false);
  return NextResponse.json({ domain, live });
}
