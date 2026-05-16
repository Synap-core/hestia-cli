/**
 * Domain configuration — same code path as `eve domain set` on the host.
 *
 * Writes secrets.json `domain` block, then asks `TraefikService` to
 * regenerate subdomain routing files. The dashboard's `/api/networking`
 * endpoint reflects the new state on the next page load.
 */

import { NextResponse } from "next/server";
import {
  writeEveSecrets,
  validateBaseDomain,
} from "@eve/dna";
import { materializeTargets } from "@eve/lifecycle";
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

  const baseError = validateBaseDomain(primary);
  if (baseError) {
    return NextResponse.json({ error: baseError }, { status: 400 });
  }

  // Persist intent first — even if Traefik write fails, the dashboard
  // reads this back as the "what the user wanted" state.
  await writeEveSecrets({ domain: { primary, ssl, email } });

  const results = await materializeTargets(null, ["backend-env", "traefik-routes"]);
  const routeResult = results.find((r) => r.target === "traefik-routes");
  if (!routeResult?.ok) {
    return NextResponse.json(
      {
        ok: true,
        traefikUpdated: false,
        warning: `Domain saved but Traefik wasn't reachable: ${routeResult?.error ?? routeResult?.summary ?? "unknown error"}. Run \`eve domain repair\` on the host.`,
      },
      { status: 200 },
    );
  }

  return NextResponse.json({ ok: true, traefikUpdated: routeResult.changed });
}

/** DELETE — revert to no domain (localhost). */
export async function DELETE() {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  await writeEveSecrets({
    domain: { primary: undefined, ssl: false, email: undefined },
  });

  const results = await materializeTargets(null, ["backend-env", "traefik-routes"]);
  const routeResult = results.find((r) => r.target === "traefik-routes");
  if (!routeResult?.ok) {
    return NextResponse.json(
      {
        ok: true,
        traefikUpdated: false,
        warning: routeResult?.error ?? routeResult?.summary ?? "unknown error",
      },
      { status: 200 },
    );
  }

  return NextResponse.json({ ok: true, traefikUpdated: routeResult.changed });
}
