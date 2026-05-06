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
 *       - 200 `{ initialized: null, reason: "no-pod-url" }` when no pod
 *         is configured locally yet (UI shows "configure pod first")
 *       - 200 `{ initialized: null, reason: "unreachable" }` on transport
 *         or upstream error (UI shows a soft retry hint)
 *
 * No auth on this route — the home page hits it before the operator
 * has signed in to the pod, and the upstream procedure is public.
 * The route never touches secrets beyond `synap.apiUrl`.
 *
 * See: synap-team-docs/content/team/platform/eve-auth-architecture.mdx
 */

import { NextResponse } from "next/server";
import { readEveSecrets, resolveSynapUrl } from "@eve/dna";

interface TrpcSetupStatusEnvelope {
  result?: {
    data?: {
      initialized?: boolean;
      version?: string;
    };
  };
}

export async function GET() {
  let podUrl = "";
  try {
    const secrets = await readEveSecrets();
    podUrl = resolveSynapUrl(secrets) ?? "";
  } catch {
    // Falls through to the no-pod-url branch below.
  }

  if (!podUrl) {
    return NextResponse.json({
      initialized: null,
      reason: "no-pod-url",
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
