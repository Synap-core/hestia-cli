/**
 * GET /api/pod/setup-status
 *
 * Eve-side proxy that asks the user's pod whether the bootstrap (first
 * admin) flow has been completed. Powers the Home page's "create your
 * first admin" detection card.
 *
 * Wire shapes:
 *   • Upstream: `GET ${podUrl}/trpc/setup.status` (public procedure)
 *     returns either `{ result: { data: { initialized, version } } }` or
 *     the transformer-wrapped `{ result: { data: { json: { ... } } } }`.
 *   • Downstream (this route):
 *       - 200 `{ initialized, version }` when the pod responded normally
 *       - 200 `{ initialized: null, reason: "unreachable" }` on transport
 *         or upstream error (UI shows a soft retry hint)
 *
 * No auth on this route — the home page hits it before the operator
 * has signed in to the pod, and the upstream procedure is public.
 *
 * See: synap-team-docs/content/team/platform/eve-auth-architecture.mdx
 */

import { NextResponse } from "next/server";
import { resolvePodUrl } from "@eve/dna";

interface TrpcSetupStatusEnvelope {
  result?: {
    data?: {
      initialized?: boolean;
      version?: string;
      json?: {
        initialized?: boolean;
        version?: string;
      };
    };
  };
}

interface SetupStatusData {
  initialized: boolean;
  version?: string;
}

function parseSetupStatusEnvelope(json: unknown): SetupStatusData | null {
  const envelope = Array.isArray(json) ? json[0] : json;
  if (!envelope || typeof envelope !== "object") return null;

  const data = (envelope as TrpcSetupStatusEnvelope).result?.data;
  const payload = data?.json ?? data;
  if (!payload || typeof payload.initialized !== "boolean") return null;

  return {
    initialized: payload.initialized,
    version: payload.version,
  };
}

export async function GET(req: Request) {
  const podUrl = await resolvePodUrl(undefined, req.url, req.headers);

  if (!podUrl) {
    console.error("[setup-status] podUrl is empty — resolvePodUrl returned falsy");
    console.error("[setup-status] req.url =", req.url);
    console.error("[setup-status] process.env.NEXT_PUBLIC_POD_URL =", process.env.NEXT_PUBLIC_POD_URL);
    console.error("[setup-status] process.env.EVE_HOME =", process.env.EVE_HOME);
    return NextResponse.json({
      initialized: null,
      reason: "no-pod-url",
    });
  }

  const base = podUrl.replace(/\/+$/, "");
  console.log("[setup-status] derived podUrl =", podUrl);

  try {
    const res = await fetch(`${base}/trpc/setup.status`, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });

    if (!res.ok) {
      console.error("[setup-status] upstream returned status", res.status);
      return NextResponse.json({
        initialized: null,
        reason: `upstream-${res.status}`,
      });
    }

    const json = await res.json();
    const data = parseSetupStatusEnvelope(json);
    console.log("[setup-status] upstream response data:", JSON.stringify(data));
    if (!data) {
      console.error("[setup-status] unexpected response shape:", JSON.stringify(json));
      return NextResponse.json({
        initialized: null,
        reason: "unexpected-response-shape",
      });
    }

    return NextResponse.json({
      initialized: data.initialized,
      version: data.version ?? null,
      podUrl: base,
    });
  } catch (err) {
    console.error("[setup-status] fetch threw:", err);
    return NextResponse.json({
      initialized: null,
      reason: "fetch-exception",
    });
  }
}
