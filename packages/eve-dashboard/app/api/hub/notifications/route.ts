/**
 * `/api/hub/notifications` — passthrough for the notifications inbox.
 *
 *   GET  → list the operator's notifications (query params forwarded —
 *          typically `status`, `limit`).
 *   POST → mark-read / mark-actioned / create. Body is forwarded
 *          verbatim; the pod chooses the action based on `type`.
 *
 * Pod side: synap-backend/packages/api/src/routers/hub-protocol/rest/notifications.ts
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

  const search = req.nextUrl.search;
  const url = `${pod.podUrl}/api/hub/notifications${search}`;

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
    upstream = await fetch(`${pod.podUrl}/api/hub/notifications`, {
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
