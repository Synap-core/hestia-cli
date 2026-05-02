import { NextResponse } from "next/server";
import { readEveSecrets, getAccessUrls, entityStateManager, getServerIp } from "@eve/dna";
import { requireAuth } from "@/lib/auth-server";
import { resolve4 } from "node:dns/promises";

async function resolveDnsForServer(host: string, expectedIp: string | null): Promise<boolean> {
  if (!expectedIp) return false;
  try {
    const addresses = await resolve4(host);
    return addresses.includes(expectedIp);
  } catch {
    return false;
  }
}

export async function GET() {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const secrets = await readEveSecrets();

  let installedComponents: string[] | undefined;
  try {
    installedComponents = await entityStateManager.getInstalledComponents();
  } catch {
    // State not initialized yet — return all services
  }

  const urls = getAccessUrls(secrets, installedComponents);
  const serverIp = getServerIp();

  // Resolve DNS for each domain URL in parallel; mark whether the record points
  // to this server. The dashboard renders missing/wrong DNS in muted style.
  const enriched = await Promise.all(urls.map(async (svc) => {
    if (!svc.domainUrl) return svc;
    const host = svc.domainUrl.replace(/^https?:\/\//, "").split("/")[0];
    const dnsReady = await resolveDnsForServer(host, serverIp);
    return { ...svc, dnsReady };
  }));

  return NextResponse.json({ urls: enriched, domain: secrets?.domain ?? null, serverIp });
}
