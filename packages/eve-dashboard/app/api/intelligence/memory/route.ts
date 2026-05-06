/**
 * Intelligence memory proxy — lists memory facts from the pod Hub.
 *
 * Uses the service channel (eve agent API key) to talk to the Hub's
 * /memory endpoint. Never exposes the API key to the browser.
 */

import { NextResponse } from "next/server";
import { loadPodAuth, podNotPairedResponse, passthrough, upstreamUnreachable } from "../../hub/_lib";
import { requireAuth } from "@/lib/auth-server";

export async function GET(req: Request) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const serviceAuth = await loadPodAuth();
  if (!serviceAuth) return podNotPairedResponse();

  const { searchParams } = new URL(req.url);
  const limit = searchParams.get("limit") ?? "50";

  try {
    const upstream = await fetch(
      `${serviceAuth.podUrl}/api/hub/memory?limit=${limit}`,
      {
        headers: { Authorization: `Bearer ${serviceAuth.apiKey}` },
        cache: "no-store",
      },
    );
    return passthrough(upstream);
  } catch (err) {
    return upstreamUnreachable(err);
  }
}
