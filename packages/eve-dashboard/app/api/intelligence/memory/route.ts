/**
 * Intelligence memory proxy — lists memory facts from the pod Hub.
 *
 * Uses the service channel (eve agent API key) to talk to the Hub's
 * /memory endpoint. Never exposes the API key to the browser.
 */

import { NextResponse } from "next/server";
import { loadPodAuth, podNotPairedResponse, passthrough, upstreamUnreachable } from "../../hub/_lib";

export async function GET(req: Request) {
  const auth = await loadPodAuth();
  if (!auth) return podNotPairedResponse();

  const { searchParams } = new URL(req.url);
  const limit = searchParams.get("limit") ?? "50";

  try {
    const upstream = await fetch(
      `${auth.podUrl}/api/hub/memory?limit=${limit}`,
      {
        headers: { Authorization: `Bearer ${auth.apiKey}` },
        cache: "no-store",
      },
    );
    return passthrough(upstream);
  } catch (err) {
    return upstreamUnreachable(err);
  }
}
