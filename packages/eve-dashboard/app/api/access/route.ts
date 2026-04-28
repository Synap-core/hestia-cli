import { NextResponse } from "next/server";
import { readEveSecrets, getAccessUrls } from "@eve/dna";
import { requireAuth } from "@/lib/auth-server";

export async function GET() {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const secrets = await readEveSecrets(process.cwd());
  const urls = getAccessUrls(secrets);
  return NextResponse.json({ urls, domain: secrets?.domain ?? null });
}
