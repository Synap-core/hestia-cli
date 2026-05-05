/**
 * `/api/hub/proposals` — Hub Protocol passthrough for proposals.
 *
 *   GET  → list proposals (forwards `status`, `workspaceId`, `userId` query params).
 *          Default upstream behavior is `status=pending`.
 *   POST → create a proposal on behalf of an agent. Body is forwarded verbatim
 *          to the pod which validates `targetType / targetId / proposalType / data`.
 *
 * Pod side: synap-backend/packages/api/src/routers/hub-protocol/rest/proposals.ts
 */

import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth-server";
import {
  loadPodAuth,
  passthrough,
  podNotPairedResponse,
  upstreamUnreachable,
} from "../_lib";

export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const pod = await loadPodAuth();
  if (!pod) return podNotPairedResponse();

  // Forward all query params verbatim. The pod expects `status`,
  // `workspaceId`, `userId` (the latter is optional — when omitted the
  // pod scopes to the API key's user).
  const search = req.nextUrl.search; // includes leading `?` if non-empty
  const url = `${pod.podUrl}/api/hub/proposals${search}`;

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${pod.apiKey}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });
  } catch (err) {
    return upstreamUnreachable(err);
  }
  return passthrough(upstream);
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const pod = await loadPodAuth();
  if (!pod) return podNotPairedResponse();

  const body = await req.text();

  let upstream: Response;
  try {
    upstream = await fetch(`${pod.podUrl}/api/hub/proposals`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${pod.apiKey}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body,
      cache: "no-store",
    });
  } catch (err) {
    return upstreamUnreachable(err);
  }
  return passthrough(upstream);
}
