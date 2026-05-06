/**
 * POST /api/pod/magic-link
 *
 * Eve-side proxy for generating a bootstrap magic link.
 *
 * Calls the pod's `POST /setup/magic-link` (PROVISIONING_TOKEN auth)
 * which returns a short-lived JWT URL the operator pastes into their
 * browser to complete first-admin setup.
 *
 * Returns:
 *   200 { ok: true, url }     — magic link URL for copy-paste
 *   200 { ok: true, signupUrl } — fallback if pod is too old to
 *                                  have the /setup/magic-link route
 *   401 { error: "Unauthorized" }   — eve-session missing
 *   409 { error: "admin-exists" }   — already has an admin
 *   503 { error: "no-pod-url" }
 *   503 { error: "no-bootstrap-token" }
 *   502 { error: "pod-unreachable", detail }
 */

import { NextResponse } from "next/server";
import { readEveSecrets, resolveSynapUrl } from "@eve/dna";
import { requireAuth } from "@/lib/auth-server";
import { resolveProvisioningToken } from "@eve/lifecycle";

interface BootstrapTokenResponse {
  ok?: boolean;
  token?: string;
  url?: string;
  error?: string;
}

function resolveBootstrapToken(secrets: Awaited<ReturnType<typeof readEveSecrets>>): string {
  const fromPod = secrets?.pod?.bootstrapToken?.trim() ?? "";
  if (fromPod) return fromPod;

  const legacy = secrets as unknown as {
    synap?: { bootstrapToken?: string };
  } | null;
  const fromSynap = legacy?.synap?.bootstrapToken?.trim() ?? "";
  if (fromSynap) return fromSynap;

  const fromEnv =
    process.env.ADMIN_BOOTSTRAP_TOKEN?.trim() ||
    process.env.EVE_PROVISIONING_TOKEN?.trim() ||
    "";
  if (fromEnv) return fromEnv;

  return resolveProvisioningToken() ?? "";
}

export async function POST(req: Request) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const secrets = await readEveSecrets();
  const podUrl = resolveSynapUrl(secrets);
  if (!podUrl) {
    return NextResponse.json(
      { error: "no-pod-url" },
      { status: 503 },
    );
  }

  const token = resolveBootstrapToken(secrets);
  if (!token) {
    return NextResponse.json(
      { error: "no-bootstrap-token" },
      { status: 503 },
    );
  }

  const base = podUrl.replace(/\/+$/, "");

  try {
    const res = await fetch(`${base}/setup/magic-link`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });

    const body = (await res.json().catch(() => null)) as BootstrapTokenResponse | null;

    if (res.status === 409) {
      return NextResponse.json(
        { error: "admin-exists" },
        { status: 409 },
      );
    }

    if (!res.ok) {
      return NextResponse.json(
        { error: "pod-unreachable", detail: body?.error ?? `Pod returned ${res.status}` },
        { status: 502 },
      );
    }

    return NextResponse.json({
      ok: true,
      url: body?.url ?? "",
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: "pod-unreachable",
        detail: err instanceof Error ? err.message : "Pod unreachable",
      },
      { status: 502 },
    );
  }
}
