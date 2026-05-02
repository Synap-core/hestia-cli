/**
 * Domain configuration — same code path as `eve domain set` on the host.
 *
 * Writes secrets.json `domain` block, then asks `TraefikService` to
 * regenerate subdomain routing files. The dashboard's `/api/networking`
 * endpoint reflects the new state on the next page load.
 */

import { NextResponse } from "next/server";
import {
  writeEveSecrets, entityStateManager,
} from "@eve/dna";
import { TraefikService } from "@eve/legs";
import { requireAuth } from "@/lib/auth-server";

export async function POST(req: Request) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const body = (await req.json().catch(() => ({}))) as {
    primary?: string;
    ssl?: boolean;
    email?: string;
  };

  const primary = body.primary?.trim();
  const ssl = Boolean(body.ssl);
  const email = body.email?.trim() || undefined;

  if (!primary) {
    return NextResponse.json({ error: "`primary` is required." }, { status: 400 });
  }
  if (ssl && !email) {
    return NextResponse.json(
      { error: "Enabling SSL requires a Let's Encrypt email." },
      { status: 400 },
    );
  }

  // Persist intent first — even if Traefik write fails, the dashboard
  // reads this back as the "what the user wanted" state.
  await writeEveSecrets({ domain: { primary, ssl, email } });

  let installedComponents: string[] | undefined;
  try {
    installedComponents = await entityStateManager.getInstalledComponents();
  } catch {
    // first-run state not initialised — fall through and route everything
  }

  try {
    const traefik = new TraefikService();
    await traefik.configureSubdomains(primary, ssl, email, installedComponents);
  } catch (err) {
    return NextResponse.json(
      {
        ok: true,
        traefikUpdated: false,
        warning: `Domain saved but Traefik wasn't reachable: ${err instanceof Error ? err.message : String(err)}. Run \`eve domain repair\` on the host.`,
      },
      { status: 200 },
    );
  }

  return NextResponse.json({ ok: true, traefikUpdated: true });
}

/** DELETE — revert to no domain (localhost). */
export async function DELETE() {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  await writeEveSecrets({
    domain: { primary: undefined, ssl: false, email: undefined },
  });

  try {
    const traefik = new TraefikService();
    await traefik.configureDomain("localhost");
  } catch (err) {
    return NextResponse.json(
      {
        ok: true,
        traefikUpdated: false,
        warning: err instanceof Error ? err.message : String(err),
      },
      { status: 200 },
    );
  }

  return NextResponse.json({ ok: true, traefikUpdated: true });
}
