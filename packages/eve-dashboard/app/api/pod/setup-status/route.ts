/**
 * GET /api/pod/setup-status
 *
 * Eve-side proxy that asks the user's pod whether the bootstrap (first
 * admin) flow has been completed. Powers the Home page's "create your
 * first admin" detection card.
 *
 * Wire shapes:
 *   • Upstream: `GET ${podUrl}/trpc/setup.status` (public procedure)
 *     returns `{ result: { data: { initialized, version } } }`.
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
    };
  };
}

export async function GET() {
  const podUrl = await resolvePodUrl();
  if (!podUrl) {
    return NextResponse.json({
      initialized: null,
      reason: "unreachable",
    });
  }

  const base = podUrl.replace(/\/+$/, "");

  try {
    const res = await fetch(`${base}/trpc/setup.status`, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });

    if (!res.ok) {
      return NextResponse.json({
        initialized: null,
        reason: "unreachable",
      });
    }

    const json = (await res.json()) as TrpcSetupStatusEnvelope;
    const data = json.result?.data;
    if (!data || typeof data.initialized !== "boolean") {
      return NextResponse.json({
        initialized: null,
        reason: "unreachable",
      });
    }

    return NextResponse.json({
      initialized: data.initialized,
      version: data.version ?? null,
      podUrl: base,
    });
  } catch {
    return NextResponse.json({
      initialized: null,
      reason: "unreachable",
    });
  }
}
