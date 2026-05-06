/**
 * Intelligence system-skills proxy — lists built-in skill packages from
 * the pod Hub's /skills/system endpoint.
 */

import { loadPodAuth, podNotPairedResponse, passthrough, upstreamUnreachable } from "../../hub/_lib";

export async function GET() {
  const auth = await loadPodAuth();
  if (!auth) return podNotPairedResponse();

  try {
    const upstream = await fetch(`${auth.podUrl}/api/hub/skills/system`, {
      headers: { Authorization: `Bearer ${auth.apiKey}` },
      cache: "no-store",
    });
    return passthrough(upstream);
  } catch (err) {
    return upstreamUnreachable(err);
  }
}
