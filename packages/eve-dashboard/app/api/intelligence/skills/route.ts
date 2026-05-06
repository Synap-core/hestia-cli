/**
 * Intelligence skills proxy — lists user-created skills from the pod Hub.
 */

import { loadPodAuth, podNotPairedResponse, passthrough, upstreamUnreachable } from "../../hub/_lib";

export async function GET() {
  const auth = await loadPodAuth();
  if (!auth) return podNotPairedResponse();

  try {
    const upstream = await fetch(`${auth.podUrl}/api/hub/skills/getSkills`, {
      headers: { Authorization: `Bearer ${auth.apiKey}` },
      cache: "no-store",
    });
    return passthrough(upstream);
  } catch (err) {
    return upstreamUnreachable(err);
  }
}
