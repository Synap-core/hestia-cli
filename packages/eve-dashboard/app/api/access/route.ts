import { NextResponse } from "next/server";
import { readEveSecrets, getAccessUrls, entityStateManager } from "@eve/dna";
import { requireAuth } from "@/lib/auth-server";

export async function GET() {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const secrets = await readEveSecrets(process.cwd());

  let installedComponents: string[] | undefined;
  try {
    installedComponents = await entityStateManager.getInstalledComponents();
  } catch {
    // State not initialized yet — return all services
  }

  const urls = getAccessUrls(secrets, installedComponents);
  return NextResponse.json({ urls, domain: secrets?.domain ?? null });
}
