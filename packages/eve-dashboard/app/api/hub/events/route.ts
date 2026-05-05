/**
 * `/api/hub/events` — Hub Protocol events passthrough.
 *
 *   GET → list recent events. Query params forwarded:
 *           `userId`, `type`, `subjectType`, `subjectId`,
 *           `fromDate` (ISO), `since` (alias for fromDate),
 *           `limit` (default 50, hard-capped at 200).
 *
 * The pod's `GET /events` requires `userId`. When the Inbox client
 * doesn't supply one, we resolve it server-side by hitting
 * `/api/hub/users/me` with the same bearer key — that way the browser
 * never has to learn its own pod-side identity. Response shape from
 * the pod: `{ events: WireEvent[] }` (newest first).
 *
 * Pod side: synap-backend/packages/api/src/routers/hub-protocol/rest/events.ts
 */

import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth-server";
import {
  loadPodAuth,
  passthrough,
  podNotPairedResponse,
  upstreamUnreachable,
  type PodAuth,
} from "../_lib";

async function resolveUserId(pod: PodAuth): Promise<string | null> {
  try {
    const r = await fetch(`${pod.podUrl}/api/hub/users/me`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${pod.apiKey}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });
    if (!r.ok) return null;
    const json = (await r.json().catch(() => null)) as { id?: string } | null;
    return json?.id ?? null;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const pod = await loadPodAuth();
  if (!pod) return podNotPairedResponse();

  // Map `since` → `fromDate` when only `since` is supplied (the SSE
  // reconnection idiom). Don't clobber an explicit `fromDate`.
  const search = new URLSearchParams(req.nextUrl.searchParams);
  if (search.has("since") && !search.has("fromDate")) {
    const sinceVal = search.get("since");
    if (sinceVal) search.set("fromDate", sinceVal);
    search.delete("since");
  }

  // The pod requires userId. Resolve once via /users/me when omitted.
  if (!search.has("userId")) {
    const userId = await resolveUserId(pod);
    if (userId) search.set("userId", userId);
    // If we couldn't resolve, fall through and let the upstream 400
    // surface to the client — better than silently swallowing.
  }

  const qs = search.toString();
  const url = `${pod.podUrl}/api/hub/events${qs ? `?${qs}` : ""}`;

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
