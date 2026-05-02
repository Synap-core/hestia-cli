import { NextRequest, NextResponse } from "next/server";
import { SignJWT } from "jose";
import { readEveSecrets } from "@eve/dna";

export async function POST(req: NextRequest) {
  const body = await req.json() as { secret?: string };
  const secret = body.secret?.trim();

  if (!secret) {
    return NextResponse.json({ error: "Secret required" }, { status: 400 });
  }

  const secrets = await readEveSecrets();
  const dashboardSecret = secrets?.dashboard?.secret;

  if (!dashboardSecret || secret !== dashboardSecret) {
    return NextResponse.json({ error: "Invalid key" }, { status: 401 });
  }

  const key = new TextEncoder().encode(dashboardSecret);
  const token = await new SignJWT({ sub: "eve-dashboard" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("48h")
    .sign(key);

  const res = NextResponse.json({ ok: true });
  res.cookies.set("eve-session", token, {
    httpOnly: true,
    sameSite: "strict",
    maxAge: 48 * 60 * 60,
    path: "/",
  });
  return res;
}
