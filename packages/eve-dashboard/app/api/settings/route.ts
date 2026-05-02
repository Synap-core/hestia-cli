/**
 * Settings — show non-sensitive Eve metadata (version, hostname, dashboard
 * secret presence) and accept rotate requests.
 *
 * Note: rotating the dashboard secret invalidates the user's current session
 * (the JWT was signed with the old secret) — the response signs them out.
 */

import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import {
  readEveSecrets,
  writeEveSecrets,
  entityStateManager,
} from "@eve/dna";
import { requireAuth } from "@/lib/auth-server";

const COMPONENTS_REGISTRY_PATH = "/opt/eve/packages/@eve/dna/src/components.ts";

function readEveVersion(): string | null {
  // Best-effort read of the installed eve-cli package.json on the host.
  try {
    const path = "/opt/eve/packages/eve-cli/package.json";
    if (!existsSync(path)) return null;
    const pkg = JSON.parse(readFileSync(path, "utf-8")) as { version?: string };
    return pkg.version ?? null;
  } catch {
    return null;
  }
}

export async function GET() {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const secrets = await readEveSecrets();
  const state = await entityStateManager.getState().catch(() => null);

  return NextResponse.json({
    eveVersion: readEveVersion(),
    initializedAt: state?.initializedAt ?? null,
    hostname: state?.metadata?.hostname ?? null,
    platform: state?.metadata?.platform ?? null,
    dashboardSecretSet: !!secrets?.dashboard?.secret,
    dashboardPort: secrets?.dashboard?.port ?? 7979,
    registryPath: COMPONENTS_REGISTRY_PATH,
  });
}

export async function POST(req: Request) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const body = (await req.json().catch(() => ({}))) as { action?: string };

  if (body.action === "rotate-secret") {
    const newSecret = randomBytes(32).toString("hex");
    await writeEveSecrets({ dashboard: { secret: newSecret } });
    // Clear the session cookie — user has to re-auth with the new secret.
    const res = NextResponse.json({ ok: true, newSecret });
    res.cookies.delete("eve-session");
    return res;
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
