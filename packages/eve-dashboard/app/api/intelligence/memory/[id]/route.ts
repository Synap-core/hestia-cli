/**
 * Intelligence memory proxy — delete a single fact by ID.
 */

import { NextResponse } from "next/server";
import { loadPodAuth, podNotPairedResponse, passthrough, upstreamUnreachable } from "../../../hub/_lib";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await loadPodAuth();
  if (!auth) return podNotPairedResponse();

  const { id } = await params;

  try {
    const upstream = await fetch(`${auth.podUrl}/api/hub/memory/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${auth.apiKey}` },
      cache: "no-store",
    });
    return passthrough(upstream);
  } catch (err) {
    return upstreamUnreachable(err);
  }
}
