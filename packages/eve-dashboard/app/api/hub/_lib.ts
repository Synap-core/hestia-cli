/**
 * Hub Protocol proxy — shared helpers. THIS IS THE SERVICE CHANNEL.
 *
 * The two-channel rule (see `eve-credentials.mdx`):
 *
 *   - `/api/hub/*`  → service / agent identity. Uses the eve agent API
 *                     key. ONLY for genuinely agentic actions: agents
 *                     submitting proposals, OpenClaw skill round-trips,
 *                     proactive nudges. NEVER for human inbox / approve
 *                     / mark-read / settings actions.
 *   - `/api/pod/*`  → user identity. Uses `pod.userToken` (Kratos
 *                     session minted via JWT-Bearer exchange). The
 *                     default for any operator-driven UI feature.
 *
 * If you're adding a new feature, ask: "if I were doing this manually
 * in a terminal, would I authenticate as me-the-human or me-the-
 * service?" When in doubt, the answer is `/api/pod/*`.
 *
 * Every `/api/hub/*` route is a thin server-side passthrough to the
 * paired Synap pod's `/api/hub/*` REST surface. The proxy exists for
 * the same reasons as `/api/marketplace/*`:
 *
 *   • Token hygiene — the pod API key lives in `~/.eve/secrets.json`
 *     on the operator's host. The browser never sees it.
 *   • CORS — self-hosted pod URLs aren't allow-listed for arbitrary
 *     Eve frontends. Server-to-server has no CORS.
 *   • Single failure mode — when the pod isn't paired we return 503
 *     with `{ error: "Pod not paired" }`, which the Inbox UI maps to a
 *     "Sign-in required" empty state.
 *
 * All proxies preserve upstream status + body verbatim. Always
 * `cache: "no-store"`.
 */

import { NextResponse } from "next/server";
import { readEveSecrets, resolveSynapUrl } from "@eve/dna";

export interface PodAuth {
  podUrl: string;
  apiKey: string;
}

/**
 * Resolve the local pod URL + API key from `~/.eve/secrets.json`.
 *
 * Returns `null` when the pod is unreachable or unpaired so the caller
 * can short-circuit with a 503. Loud-failing here would surface as a
 * 500 in the UI which we don't want — the unpaired state is a
 * legitimate first-run condition, not an error.
 */
export async function loadPodAuth(): Promise<PodAuth | null> {
  const secrets = await readEveSecrets().catch(() => null);
  const podUrl = secrets ? resolveSynapUrl(secrets) : "";
  const apiKey = secrets?.synap?.apiKey;
  if (!podUrl || !apiKey) return null;
  return { podUrl, apiKey };
}

/** Standard 503 response for the unpaired-pod state. */
export function podNotPairedResponse(): NextResponse {
  return NextResponse.json(
    { error: "Pod not paired", message: "Sign in to your Synap pod from Settings." },
    { status: 503 },
  );
}

/**
 * Forward an upstream Hub Protocol response to the client unchanged —
 * status code, content-type, and body all passthrough. Always sets
 * `Cache-Control: no-store` so user-scoped data isn't cached on a
 * shared host.
 */
export async function passthrough(upstream: Response): Promise<NextResponse> {
  const text = await upstream.text();
  const headers = new Headers({
    "Content-Type":
      upstream.headers.get("content-type") ?? "application/json",
    "Cache-Control": "no-store",
  });
  return new NextResponse(text, {
    status: upstream.status,
    headers,
  });
}

/** 502 for upstream network failures (pod unreachable). */
export function upstreamUnreachable(err: unknown): NextResponse {
  return NextResponse.json(
    {
      error: "pod_unreachable",
      message: err instanceof Error ? err.message : "Network error",
    },
    { status: 502 },
  );
}
