/**
 * Stalwart domains — list / create.
 * GET  → listPrincipals('domain')
 * POST → createDomain({ name })
 */
import { NextResponse } from "next/server";
import { readEveSecrets } from "@eve/dna";
import { StalwartAdmin } from "@eve/mouth";
import { requireAuth } from "@/lib/auth-server";

function makeAdmin(adminPassword: string) {
  return new StalwartAdmin({ adminPassword });
}

export async function GET() {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const secrets = await readEveSecrets().catch(() => null);
  const adminPassword = secrets?.stalwart?.adminPassword;

  if (!adminPassword) {
    return NextResponse.json(
      { error: "Stalwart admin password not configured. Run `eve add stalwart` first." },
      { status: 503 },
    );
  }

  try {
    const admin = makeAdmin(adminPassword);
    const domains = await admin.listPrincipals("domain");
    return NextResponse.json({ domains });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to list domains" },
      { status: 502 },
    );
  }
}

export async function POST(req: Request) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const secrets = await readEveSecrets().catch(() => null);
  const adminPassword = secrets?.stalwart?.adminPassword;

  if (!adminPassword) {
    return NextResponse.json(
      { error: "Stalwart admin password not configured. Run `eve add stalwart` first." },
      { status: 503 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as { name?: string };
  if (!body.name?.trim()) {
    return NextResponse.json({ error: "`name` is required." }, { status: 400 });
  }

  try {
    const admin = makeAdmin(adminPassword);
    await admin.createDomain(body.name.trim());
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create domain" },
      { status: 400 },
    );
  }
}
