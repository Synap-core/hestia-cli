/**
 * `/api/hub/proposals/[id]` — PATCH passthrough for approve / reject / revise.
 *
 * The pod's PATCH `/api/hub/proposals/:id` accepts a discriminated body:
 *
 *   • `{ action: "approve", reason?: string }`  → resolve as approved.
 *   • `{ action: "reject",  reason?: string }`  → resolve as rejected.
 *   • `{ data: {...}, summary?: string }`       → AI-revise the payload
 *                                                  while still pending.
 *
 * This proxy is shape-agnostic: it forwards the body verbatim and
 * relays the upstream status. The pod is the source of truth for which
 * variants are allowed.
 */

import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth-server";
import {
  loadPodAuth,
  passthrough,
  podNotPairedResponse,
  upstreamUnreachable,
} from "../../_lib";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const pod = await loadPodAuth();
  if (!pod) return podNotPairedResponse();

  const { id } = await params;
  const body = await req.text();

  let upstream: Response;
  try {
    upstream = await fetch(
      `${pod.podUrl}/api/hub/proposals/${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${pod.apiKey}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body,
        cache: "no-store",
      },
    );
  } catch (err) {
    return upstreamUnreachable(err);
  }
  return passthrough(upstream);
}
