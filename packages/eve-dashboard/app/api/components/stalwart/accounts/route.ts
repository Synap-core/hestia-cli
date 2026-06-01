/**
 * Stalwart accounts (mailboxes) — list / create.
 * GET  → listPrincipals('individual')
 * POST → createAccount({ email, password, description? })
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
    const accounts = await admin.listPrincipals("individual");
    return NextResponse.json({ accounts });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to list accounts" },
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

  const body = (await req.json().catch(() => ({}))) as {
    email?: string;
    password?: string;
    description?: string;
  };

  if (!body.email?.trim() || !body.password) {
    return NextResponse.json(
      { error: "`email` and `password` are required." },
      { status: 400 },
    );
  }

  try {
    const admin = makeAdmin(adminPassword);
    await admin.createAccount({
      email: body.email.trim(),
      password: body.password,
      description: body.description?.trim() || undefined,
    });
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create account" },
      { status: 400 },
    );
  }
}
