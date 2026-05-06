/**
 * Intelligence skills proxy — execute a skill by ID.
 */

import { loadPodAuth, podNotPairedResponse, passthrough, upstreamUnreachable } from "../../../../hub/_lib";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await loadPodAuth();
  if (!auth) return podNotPairedResponse();

  const { id } = await params;
  const body = await req.text().catch(() => "{}");

  try {
    const upstream = await fetch(
      `${auth.podUrl}/api/hub/skills/${id}/execute`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${auth.apiKey}`,
          "Content-Type": "application/json",
        },
        body,
        cache: "no-store",
      },
    );
    return passthrough(upstream);
  } catch (err) {
    return upstreamUnreachable(err);
  }
}
