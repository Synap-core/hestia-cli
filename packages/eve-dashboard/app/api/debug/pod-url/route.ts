/**
 * Diagnostic endpoint to debug pod URL resolution.
 * DELETE after debugging.
 */
import { NextResponse } from "next/server";
import { resolvePodUrl } from "@eve/dna";

export async function GET(req: Request) {
  const result: Record<string, unknown> = {
    req_url: req.url,
    req_method: req.method,
    req_headers: {
      host: req.headers.get("host") ?? null,
      "x-forwarded-host": req.headers.get("x-forwarded-host") ?? null,
      "x-forwarded-proto": req.headers.get("x-forwarded-proto") ?? null,
      "x-real-ip": req.headers.get("x-real-ip") ?? null,
      "x-forwarded-for": req.headers.get("x-forwarded-for") ?? null,
    },
    env: {
      NEXT_PUBLIC_POD_URL: process.env.NEXT_PUBLIC_POD_URL ?? null,
      EVE_HOME: process.env.EVE_HOME ?? null,
    },
  };

  const resolved = await resolvePodUrl(undefined, req.url);
  result.resolved = resolved || "(empty — nothing reachable)";

  // Also derive from x-forwarded-host which is the real full URL
  const forwardedHost = req.headers.get("x-forwarded-host")
    ?? req.headers.get("host")
    ?? null;
  let fullUrl: string | null = null;
  if (forwardedHost) {
    const proto = req.headers.get("x-forwarded-proto") ?? "http";
    fullUrl = `${proto}://${forwardedHost}/api/debug/pod-url`;
  }
  result.fallback_url = fullUrl;

  const derived = fullUrl
    ? `https://pod.${forwardedHost!.replace(/^eve\./, "")}`
    : null;
  result.ideal_derived = derived;

  return NextResponse.json(result, { status: 200 });
}
