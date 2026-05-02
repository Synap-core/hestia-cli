import { jwtVerify } from "jose";
import { cookies } from "next/headers";
import { readEveSecrets } from "@eve/dna";
import { NextResponse } from "next/server";

export async function requireAuth(): Promise<{ error: NextResponse } | { ok: true }> {
  const cookieStore = await cookies();
  const token = cookieStore.get("eve-session")?.value;
  if (!token) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const secrets = await readEveSecrets();
  const dashboardSecret = secrets?.dashboard?.secret;
  if (!dashboardSecret) {
    return { error: NextResponse.json({ error: "Dashboard not configured" }, { status: 503 }) };
  }

  try {
    const key = new TextEncoder().encode(dashboardSecret);
    await jwtVerify(token, key);
    return { ok: true };
  } catch {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
}
