import { jwtVerify } from "jose";
import { cookies } from "next/headers";
import { readEveSecrets } from "@eve/dna";
import { NextResponse } from "next/server";

export interface AuthUser {
  uid: string;
  email: string;
}

async function resolveSecret(): Promise<{ token: string; secret: string } | { error: NextResponse }> {
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
  return { token, secret: dashboardSecret };
}

export async function requireAuth(): Promise<{ error: NextResponse } | { ok: true }> {
  const resolved = await resolveSecret();
  if ("error" in resolved) return resolved;
  try {
    const key = new TextEncoder().encode(resolved.secret);
    await jwtVerify(resolved.token, key);
    return { ok: true };
  } catch {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
}

/** Verify the eve-session JWT and return its claims. */
export async function getAuthUser(): Promise<{ user: AuthUser } | { error: NextResponse }> {
  const resolved = await resolveSecret();
  if ("error" in resolved) return resolved;
  try {
    const key = new TextEncoder().encode(resolved.secret);
    const { payload } = await jwtVerify(resolved.token, key);
    return {
      user: {
        uid: typeof payload["uid"] === "string" ? payload["uid"] : "",
        email: typeof payload["email"] === "string" ? payload["email"] : "",
      },
    };
  } catch {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
}
